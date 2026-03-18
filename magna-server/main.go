package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Messung struct {
	ID                 int     `json:"id"`
	Datum              string  `json:"datum"`
	Fertigungsbereich  string  `json:"fertigungsbereich"`
	AbteilungZSB       string  `json:"abteilung_zsb"`
	AbteilungUZSB      string  `json:"abteilung_uzsb"`
	Name               string  `json:"name"`
	BatchNr            string  `json:"batch_nr"`
	Station            string  `json:"station"`
	Pruefzweck         string  `json:"pruefzweck"`
	Pruefart           string  `json:"pruefart"`
	Einstellmassnahme  string  `json:"einstellmassnahme"`
	NokID              string  `json:"nok_id"`
	Bemerkungen        string  `json:"bemerkungen"`
	MessungPlanmaessig string  `json:"messung_planmaessig"`
	Ausgeschleust      string  `json:"ausgeschleust"`
	ErstelltAm         string  `json:"erstellt_am"`
	FormID             *int    `json:"form_id"`
	DatenJSON          *string `json:"daten_json"`
}

type MessungDynamic struct {
	FormID int                    `json:"form_id"`
	Daten  map[string]interface{} `json:"daten"`
}

type DropdownOption struct {
	ID        int    `json:"id"`
	Kategorie string `json:"kategorie"`
	Wert      string `json:"wert"`
	Position  int    `json:"position"`
}

type FormularDefinition struct {
	ID             int    `json:"id"`
	Name           string `json:"name"`
	Version        int    `json:"version"`
	Active         bool   `json:"active"`
	CanvasWidth    int    `json:"canvas_width"`
	CanvasHeight   int    `json:"canvas_height"`
	Definition     string `json:"definition"`
	ErstelltAm     string `json:"erstellt_am"`
	AktualisiertAm string `json:"aktualisiert_am"`
}

type Workflow struct {
	ID             int    `json:"id"`
	Name           string `json:"name"`
	Active         bool   `json:"active"`
	Definition     string `json:"definition"`
	ErstelltAm     string `json:"erstellt_am"`
	AktualisiertAm string `json:"aktualisiert_am"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./daten.db?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}

	tables := []string{
		`CREATE TABLE IF NOT EXISTS messungen (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			datum TEXT NOT NULL DEFAULT '',
			fertigungsbereich TEXT NOT NULL DEFAULT '',
			abteilung_zsb TEXT NOT NULL DEFAULT '',
			abteilung_uzsb TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL DEFAULT '',
			batch_nr TEXT DEFAULT '',
			station TEXT NOT NULL DEFAULT '',
			pruefzweck TEXT NOT NULL DEFAULT '',
			pruefart TEXT NOT NULL DEFAULT '',
			einstellmassnahme TEXT NOT NULL DEFAULT '',
			nok_id TEXT NOT NULL DEFAULT '',
			bemerkungen TEXT DEFAULT '',
			messung_planmaessig TEXT NOT NULL DEFAULT '',
			ausgeschleust TEXT NOT NULL DEFAULT '',
			erstellt_am TEXT NOT NULL DEFAULT '',
			form_id INTEGER,
			daten_json TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS dropdown_optionen (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			kategorie TEXT NOT NULL,
			wert TEXT NOT NULL,
			position INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE TABLE IF NOT EXISTS pruefplan (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			bezeichnung TEXT NOT NULL,
			fertigungsbereich TEXT NOT NULL DEFAULT '',
			abteilung TEXT NOT NULL DEFAULT '',
			station TEXT NOT NULL DEFAULT '',
			pruefart TEXT NOT NULL DEFAULT '',
			haeufigkeit TEXT NOT NULL DEFAULT 'taeglich',
			intervall_wert INTEGER NOT NULL DEFAULT 1,
			naechste_faelligkeit TEXT,
			letzte_durchfuehrung TEXT,
			aktiv INTEGER NOT NULL DEFAULT 1,
			erstellt_am TEXT NOT NULL,
			aktualisiert_am TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS pruefplan_durchfuehrungen (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pruefplan_id INTEGER NOT NULL,
			messung_id INTEGER,
			faelligkeit_datum TEXT NOT NULL,
			faelligkeit_uhrzeit TEXT NOT NULL DEFAULT '07:00',
			status TEXT NOT NULL DEFAULT 'offen',
			gebracht_am TEXT,
			gebracht_von TEXT,
			gemessen_am TEXT,
			erstellt_am TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS einstellungen (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS workflows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			active INTEGER NOT NULL DEFAULT 0,
			definition TEXT NOT NULL,
			erstellt_am TEXT NOT NULL,
			aktualisiert_am TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS formular_definitionen (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			version INTEGER NOT NULL DEFAULT 1,
			active INTEGER NOT NULL DEFAULT 0,
			canvas_width INTEGER NOT NULL DEFAULT 700,
			canvas_height INTEGER NOT NULL DEFAULT 800,
			definition TEXT NOT NULL,
			erstellt_am TEXT NOT NULL,
			aktualisiert_am TEXT NOT NULL
		);`,
	}

	for _, t := range tables {
		if _, err := db.Exec(t); err != nil {
			log.Fatal(err)
		}
	}

	// Migration: add columns to existing messungen table if missing
	migrations := []string{
		"ALTER TABLE messungen ADD COLUMN form_id INTEGER",
		"ALTER TABLE messungen ADD COLUMN pruefplan_id INTEGER",
		"ALTER TABLE messungen ADD COLUMN durchfuehrung_id INTEGER",
		"ALTER TABLE messungen ADD COLUMN daten_json TEXT",
	}
	for _, m := range migrations {
		db.Exec(m) // ignore errors (column already exists)
	}

	// Generate upcoming Durchführungen
	generateDurchfuehrungen()

	// Seed: default settings
	var settingsCount int
	db.QueryRow("SELECT COUNT(*) FROM einstellungen").Scan(&settingsCount)
	if settingsCount == 0 {
		db.Exec(`INSERT INTO einstellungen (key, value) VALUES ('kontextmenu', ?)`,
			`{"target_column":"messergebnis","items":[{"label":"OK","value":"OK","color":"#2e7d32"},{"label":"NOK","value":"NOK","color":"#c62828"},{"label":"GZ","value":"GZ","color":"#ef6c00"}]}`)
	}

	// Seed: create default form if none exists
	var count int
	db.QueryRow("SELECT COUNT(*) FROM formular_definitionen").Scan(&count)
	if count == 0 {
		seedDefaultForm()
	}
}

func seedDefaultForm() {
	definition := `{"pruefzwecke":[` +
		// Erstteilabnahme
		`{"id":"pz-erstteil","name":"Erstteilabnahme","icon":"1","description":"Prüfung des ersten produzierten Teils","steps":[` +
		`{"id":"step-pp","type":"pruefplan","title":"Prüfplan wählen","prefill_from_plan":true},` +
		`{"id":"step-form1","type":"form","title":"Messdaten erfassen","rows":[` +
		`{"id":"row-1","elements":[{"id":"el-datum1","type":"datefield","field_key":"datum","label":"Datum","required":true,"flex":1,"default_today":true},{"id":"el-fert1","type":"dropdown","field_key":"fertigungsbereich","label":"Fertigungsbereich","required":true,"flex":2,"dropdown_kategorie":"fertigungsbereich"}]},` +
		`{"id":"row-2","elements":[{"id":"el-zsb1","type":"dropdown","field_key":"abteilung_zsb","label":"Abteilung (ZSB)","required":true,"flex":1,"dropdown_kategorie":"abteilung_zsb"}]},` +
		`{"id":"row-3","elements":[{"id":"el-uzsb1","type":"dropdown","field_key":"abteilung_uzsb","label":"Abteilung (UZSB/HF-Teil)","required":true,"flex":1,"dropdown_kategorie":"abteilung_uzsb"}]},` +
		`{"id":"row-4","elements":[{"id":"el-name1","type":"textbox","field_key":"name","label":"Name","required":true,"flex":2,"placeholder":""},{"id":"el-batch1","type":"textbox","field_key":"batch_nr","label":"Batch-Nr./Tagesstempel","required":false,"flex":2,"placeholder":""},{"id":"el-station1","type":"dropdown","field_key":"station","label":"Station","required":true,"flex":1,"dropdown_kategorie":"station"}]},` +
		`{"id":"row-5","elements":[{"id":"el-art1","type":"dropdown","field_key":"pruefart","label":"Prüfart","required":true,"flex":1,"dropdown_kategorie":"pruefart"}]},` +
		`{"id":"row-6","elements":[{"id":"el-bem1","type":"textbox","field_key":"bemerkungen","label":"Bemerkungen/Eingestellte Schweißnähte","required":false,"flex":1,"placeholder":""}]},` +
		`{"id":"row-7","elements":[{"id":"el-ausg1","type":"radiogroup","field_key":"ausgeschleust","label":"Ausgeschleustes Bauteil?","required":true,"flex":1,"options":["ja","nein"]}]}` +
		`],"auto_values":{"pruefzweck":"Erstteilabnahme","messung_planmaessig":"ja"}}` +
		`]},` +
		// Einstellteil
		`{"id":"pz-einstell","name":"Einstellteil","icon":"E","description":"Prüfung nach Maschineneinstellung","steps":[` +
		`{"id":"step-input1","type":"input_fields","title":"Einstellteil-Daten","save_directly":true,"fields":[` +
		`{"id":"el-nok2","type":"autocomplete","field_key":"nok_id","label":"NOK-ID","required":true,"flex":1,"dropdown_kategorie":""},` +
		`{"id":"el-batch2","type":"textbox","field_key":"batch_nr","label":"Batch-Nr./Tagesstempel","required":true,"flex":1,"placeholder":""},` +
		`{"id":"el-name2","type":"textbox","field_key":"name","label":"Name Mitarbeiter","required":true,"flex":1,"placeholder":""},` +
		`{"id":"el-einst2","type":"textbox","field_key":"einstellmassnahme","label":"Einstellmaßnahme","required":true,"flex":1,"placeholder":""}` +
		`],"auto_values":{"pruefzweck":"Einstellteil","messung_planmaessig":"ja","ausgeschleust":"nein"}}` +
		`]},` +
		// Sonderprüfung
		`{"id":"pz-sonder","name":"Sonderprüfung","icon":"S","description":"Außerplanmäßige Sonderprüfung","steps":[` +
		`{"id":"step-form3","type":"form","title":"Messdaten erfassen","rows":[` +
		`{"id":"row-s1","elements":[{"id":"el-datum3","type":"datefield","field_key":"datum","label":"Datum","required":true,"flex":1,"default_today":true},{"id":"el-fert3","type":"dropdown","field_key":"fertigungsbereich","label":"Fertigungsbereich","required":true,"flex":2,"dropdown_kategorie":"fertigungsbereich"}]},` +
		`{"id":"row-s2","elements":[{"id":"el-zsb3","type":"dropdown","field_key":"abteilung_zsb","label":"Abteilung (ZSB)","required":true,"flex":1,"dropdown_kategorie":"abteilung_zsb"}]},` +
		`{"id":"row-s3","elements":[{"id":"el-uzsb3","type":"dropdown","field_key":"abteilung_uzsb","label":"Abteilung (UZSB/HF-Teil)","required":true,"flex":1,"dropdown_kategorie":"abteilung_uzsb"}]},` +
		`{"id":"row-s4","elements":[{"id":"el-name3","type":"textbox","field_key":"name","label":"Name","required":true,"flex":2,"placeholder":""},{"id":"el-batch3","type":"textbox","field_key":"batch_nr","label":"Batch-Nr./Tagesstempel","required":false,"flex":2,"placeholder":""},{"id":"el-station3","type":"dropdown","field_key":"station","label":"Station","required":true,"flex":1,"dropdown_kategorie":"station"}]},` +
		`{"id":"row-s5","elements":[{"id":"el-art3","type":"dropdown","field_key":"pruefart","label":"Prüfart","required":true,"flex":1,"dropdown_kategorie":"pruefart"},{"id":"el-einst3","type":"dropdown","field_key":"einstellmassnahme","label":"Einstellmaßnahme","required":true,"flex":1,"dropdown_kategorie":"einstellmassnahme"}]},` +
		`{"id":"row-s6","elements":[{"id":"el-nok3","type":"textbox","field_key":"nok_id","label":"NOK-ID","required":true,"flex":1,"placeholder":""}]},` +
		`{"id":"row-s7","elements":[{"id":"el-bem3","type":"textbox","field_key":"bemerkungen","label":"Bemerkungen/Eingestellte Schweißnähte","required":false,"flex":1,"placeholder":""}]},` +
		`{"id":"row-s8","elements":[{"id":"el-plan3","type":"radiogroup","field_key":"messung_planmaessig","label":"Messung Planmäßig?","required":true,"flex":1,"options":["ja","nein"]},{"id":"el-ausg3","type":"radiogroup","field_key":"ausgeschleust","label":"Ausgeschleustes Bauteil?","required":true,"flex":1,"options":["ja","nein"]}]}` +
		`],"auto_values":{"pruefzweck":"Sonderprüfung"}}` +
		`]}]}`

	now := time.Now().Format("2006-01-02 15:04:05")
	db.Exec(`INSERT INTO formular_definitionen (name, version, active, canvas_width, canvas_height, definition, erstellt_am, aktualisiert_am)
		VALUES (?, 1, 1, 700, 800, ?, ?, ?)`,
		"Messungs-Flow", definition, now, now)
	log.Println("Standard-Flow erstellt und aktiviert")
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// --- Messungen ---

func handleMessungen(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getMessungen(w, r)
	case "POST":
		createMessung(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleMessungByID(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(parts[3])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case "DELETE":
		deleteMessung(w, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getMessungen(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT * FROM messungen ORDER BY id DESC")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var result []map[string]interface{}

	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)

		row := make(map[string]interface{})
		for i, col := range cols {
			if b, ok := values[i].([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = values[i]
			}
		}
		result = append(result, row)
	}

	if result == nil {
		result = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func createMessung(w http.ResponseWriter, r *http.Request) {
	// Try dynamic format first
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if it's a dynamic submission (has "daten" key)
	var dynamic MessungDynamic
	if err := json.Unmarshal(raw, &dynamic); err == nil && dynamic.FormID > 0 && dynamic.Daten != nil {
		createMessungDynamic(w, dynamic)
		return
	}

	// Legacy format
	var m Messung
	if err := json.Unmarshal(raw, &m); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	m.ErstelltAm = time.Now().Format("2006-01-02 15:04:05")

	result, err := db.Exec(`INSERT INTO messungen
		(datum, fertigungsbereich, abteilung_zsb, abteilung_uzsb, name, batch_nr,
		station, pruefzweck, pruefart, einstellmassnahme, nok_id, bemerkungen,
		messung_planmaessig, ausgeschleust, erstellt_am)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.Datum, m.Fertigungsbereich, m.AbteilungZSB, m.AbteilungUZSB,
		m.Name, m.BatchNr, m.Station, m.Pruefzweck, m.Pruefart,
		m.Einstellmassnahme, m.NokID, m.Bemerkungen,
		m.MessungPlanmaessig, m.Ausgeschleust, m.ErstelltAm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	m.ID = int(id)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(m)
}

func createMessungDynamic(w http.ResponseWriter, d MessungDynamic) {
	datenBytes, _ := json.Marshal(d.Daten)
	datenStr := string(datenBytes)
	erstelltAm := time.Now().Format("2006-01-02 15:04:05")

	// Map known keys to legacy columns for backward compat
	getString := func(key string) string {
		if v, ok := d.Daten[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}

	result, err := db.Exec(`INSERT INTO messungen
		(datum, fertigungsbereich, abteilung_zsb, abteilung_uzsb, name, batch_nr,
		station, pruefzweck, pruefart, einstellmassnahme, nok_id, bemerkungen,
		messung_planmaessig, ausgeschleust, erstellt_am, form_id, daten_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		getString("datum"), getString("fertigungsbereich"),
		getString("abteilung_zsb"), getString("abteilung_uzsb"),
		getString("name"), getString("batch_nr"),
		getString("station"), getString("pruefzweck"),
		getString("pruefart"), getString("einstellmassnahme"),
		getString("nok_id"), getString("bemerkungen"),
		getString("messung_planmaessig"), getString("ausgeschleust"),
		erstelltAm, d.FormID, datenStr)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	// Trigger workflows
	d.Daten["id"] = id
	d.Daten["erstellt_am"] = erstelltAm
	ProcessMessungWorkflows(d.Daten)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "created"})
}

func deleteMessung(w http.ResponseWriter, id int) {
	_, err := db.Exec("DELETE FROM messungen WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// --- Dropdown Optionen ---

func handleDropdowns(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getDropdowns(w, r)
	case "POST":
		createDropdown(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleDropdownByID(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(parts[3])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case "DELETE":
		deleteDropdown(w, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getDropdowns(w http.ResponseWriter, r *http.Request) {
	kategorie := r.URL.Query().Get("kategorie")

	var rows *sql.Rows
	var err error
	if kategorie != "" {
		rows, err = db.Query("SELECT id, kategorie, wert, position FROM dropdown_optionen WHERE kategorie = ? ORDER BY position, wert", kategorie)
	} else {
		rows, err = db.Query("SELECT id, kategorie, wert, position FROM dropdown_optionen ORDER BY kategorie, position, wert")
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var optionen []DropdownOption
	for rows.Next() {
		var o DropdownOption
		if err := rows.Scan(&o.ID, &o.Kategorie, &o.Wert, &o.Position); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		optionen = append(optionen, o)
	}

	if optionen == nil {
		optionen = []DropdownOption{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(optionen)
}

func createDropdown(w http.ResponseWriter, r *http.Request) {
	var o DropdownOption
	if err := json.NewDecoder(r.Body).Decode(&o); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := db.Exec("INSERT INTO dropdown_optionen (kategorie, wert, position) VALUES (?, ?, ?)",
		o.Kategorie, o.Wert, o.Position)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	o.ID = int(id)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(o)
}

func deleteDropdown(w http.ResponseWriter, id int) {
	_, err := db.Exec("DELETE FROM dropdown_optionen WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// --- Formular Definitionen ---

func handleFormulare(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getFormulare(w, r)
	case "POST":
		createFormular(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleFormularByID(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Check for /api/formulare/active
	if parts[3] == "active" {
		getActiveFormular(w, r)
		return
	}

	id, err := strconv.Atoi(parts[3])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	// Check for /api/formulare/{id}/activate
	if len(parts) >= 5 && parts[4] == "activate" && r.Method == "POST" {
		activateFormular(w, id)
		return
	}

	switch r.Method {
	case "GET":
		getFormular(w, id)
	case "PUT":
		updateFormular(w, r, id)
	case "DELETE":
		deleteFormular(w, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getFormulare(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT id, name, version, active, canvas_width, canvas_height,
		definition, erstellt_am, aktualisiert_am FROM formular_definitionen ORDER BY aktualisiert_am DESC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var formulare []FormularDefinition
	for rows.Next() {
		var f FormularDefinition
		if err := rows.Scan(&f.ID, &f.Name, &f.Version, &f.Active, &f.CanvasWidth,
			&f.CanvasHeight, &f.Definition, &f.ErstelltAm, &f.AktualisiertAm); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		formulare = append(formulare, f)
	}

	if formulare == nil {
		formulare = []FormularDefinition{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(formulare)
}

func getFormular(w http.ResponseWriter, id int) {
	var f FormularDefinition
	err := db.QueryRow(`SELECT id, name, version, active, canvas_width, canvas_height,
		definition, erstellt_am, aktualisiert_am FROM formular_definitionen WHERE id = ?`, id).
		Scan(&f.ID, &f.Name, &f.Version, &f.Active, &f.CanvasWidth, &f.CanvasHeight,
			&f.Definition, &f.ErstelltAm, &f.AktualisiertAm)
	if err == sql.ErrNoRows {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(f)
}

func getActiveFormular(w http.ResponseWriter, r *http.Request) {
	var f FormularDefinition
	err := db.QueryRow(`SELECT id, name, version, active, canvas_width, canvas_height,
		definition, erstellt_am, aktualisiert_am FROM formular_definitionen WHERE active = 1 LIMIT 1`).
		Scan(&f.ID, &f.Name, &f.Version, &f.Active, &f.CanvasWidth, &f.CanvasHeight,
			&f.Definition, &f.ErstelltAm, &f.AktualisiertAm)
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(nil)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(f)
}

func createFormular(w http.ResponseWriter, r *http.Request) {
	var f FormularDefinition
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	f.ErstelltAm = now
	f.AktualisiertAm = now
	f.Version = 1

	result, err := db.Exec(`INSERT INTO formular_definitionen
		(name, version, active, canvas_width, canvas_height, definition, erstellt_am, aktualisiert_am)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		f.Name, f.Version, boolToInt(f.Active), f.CanvasWidth, f.CanvasHeight,
		f.Definition, f.ErstelltAm, f.AktualisiertAm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	f.ID = int(id)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(f)
}

func updateFormular(w http.ResponseWriter, r *http.Request, id int) {
	var f FormularDefinition
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := time.Now().Format("2006-01-02 15:04:05")

	_, err := db.Exec(`UPDATE formular_definitionen SET
		name = ?, definition = ?, canvas_width = ?, canvas_height = ?,
		version = version + 1, aktualisiert_am = ? WHERE id = ?`,
		f.Name, f.Definition, f.CanvasWidth, f.CanvasHeight, now, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	getFormular(w, id)
}

func activateFormular(w http.ResponseWriter, id int) {
	// Deactivate all
	db.Exec("UPDATE formular_definitionen SET active = 0")
	// Activate the selected one
	_, err := db.Exec("UPDATE formular_definitionen SET active = 1 WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "activated"})
}

func deleteFormular(w http.ResponseWriter, id int) {
	_, err := db.Exec("DELETE FROM formular_definitionen WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// --- Prüfplan ---

func handlePruefplan(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getPruefplan(w, r)
	case "POST":
		createPruefplanEntry(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handlePruefplanByID(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(parts[3])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case "PUT":
		updatePruefplanEntry(w, r, id)
	case "DELETE":
		deletePruefplanEntry(w, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getPruefplan(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT * FROM pruefplan ORDER BY naechste_faelligkeit ASC, id DESC")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var result []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)
		row := make(map[string]interface{})
		for i, col := range cols {
			if b, ok := values[i].([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = values[i]
			}
		}
		result = append(result, row)
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func createPruefplanEntry(w http.ResponseWriter, r *http.Request) {
	var entry map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	getString := func(key string) string {
		if v, ok := entry[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	getInt := func(key string) int {
		if v, ok := entry[key]; ok {
			switch val := v.(type) {
			case float64:
				return int(val)
			}
		}
		return 1
	}

	result, err := db.Exec(`INSERT INTO pruefplan
		(bezeichnung, fertigungsbereich, abteilung, station, pruefart, haeufigkeit, intervall_wert, naechste_faelligkeit, ziel_uhrzeit, aktiv, erstellt_am, aktualisiert_am)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		getString("bezeichnung"), getString("fertigungsbereich"), getString("abteilung"),
		getString("station"), getString("pruefart"), getString("haeufigkeit"),
		getInt("intervall_wert"), getString("naechste_faelligkeit"), getString("ziel_uhrzeit"), now, now)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := result.LastInsertId()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "created"})
}

func updatePruefplanEntry(w http.ResponseWriter, r *http.Request, id int) {
	var entry map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	getString := func(key string) string {
		if v, ok := entry[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	getInt := func(key string) int {
		if v, ok := entry[key]; ok {
			switch val := v.(type) {
			case float64:
				return int(val)
			}
		}
		return 1
	}

	_, err := db.Exec(`UPDATE pruefplan SET
		bezeichnung=?, fertigungsbereich=?, abteilung=?, station=?, pruefart=?,
		haeufigkeit=?, intervall_wert=?, naechste_faelligkeit=?, ziel_uhrzeit=?, aktualisiert_am=?
		WHERE id=?`,
		getString("bezeichnung"), getString("fertigungsbereich"), getString("abteilung"),
		getString("station"), getString("pruefart"), getString("haeufigkeit"),
		getInt("intervall_wert"), getString("naechste_faelligkeit"), getString("ziel_uhrzeit"), now, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

func deletePruefplanEntry(w http.ResponseWriter, id int) {
	db.Exec("DELETE FROM pruefplan WHERE id = ?", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// --- Workflows ---

func handleWorkflows(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getWorkflows(w, r)
	case "POST":
		createWorkflow(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleWorkflowByID(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(parts[3])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}
	if len(parts) >= 5 && parts[4] == "activate" && r.Method == "POST" {
		activateWorkflow(w, id)
		return
	}
	switch r.Method {
	case "GET":
		getWorkflow(w, id)
	case "PUT":
		updateWorkflow(w, r, id)
	case "DELETE":
		deleteWorkflow(w, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getWorkflows(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT id, name, active, definition, erstellt_am, aktualisiert_am
		FROM workflows ORDER BY aktualisiert_am DESC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var workflows []Workflow
	for rows.Next() {
		var wf Workflow
		if err := rows.Scan(&wf.ID, &wf.Name, &wf.Active, &wf.Definition, &wf.ErstelltAm, &wf.AktualisiertAm); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		workflows = append(workflows, wf)
	}
	if workflows == nil {
		workflows = []Workflow{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workflows)
}

func getWorkflow(w http.ResponseWriter, id int) {
	var wf Workflow
	err := db.QueryRow(`SELECT id, name, active, definition, erstellt_am, aktualisiert_am
		FROM workflows WHERE id = ?`, id).
		Scan(&wf.ID, &wf.Name, &wf.Active, &wf.Definition, &wf.ErstelltAm, &wf.AktualisiertAm)
	if err == sql.ErrNoRows {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(wf)
}

func createWorkflow(w http.ResponseWriter, r *http.Request) {
	var wf Workflow
	if err := json.NewDecoder(r.Body).Decode(&wf); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := db.Exec(`INSERT INTO workflows (name, active, definition, erstellt_am, aktualisiert_am)
		VALUES (?, ?, ?, ?, ?)`, wf.Name, boolToInt(wf.Active), wf.Definition, now, now)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := result.LastInsertId()
	wf.ID = int(id)
	wf.ErstelltAm = now
	wf.AktualisiertAm = now
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(wf)
}

func updateWorkflow(w http.ResponseWriter, r *http.Request, id int) {
	var wf Workflow
	if err := json.NewDecoder(r.Body).Decode(&wf); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := db.Exec(`UPDATE workflows SET name = ?, definition = ?, aktualisiert_am = ? WHERE id = ?`,
		wf.Name, wf.Definition, now, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	getWorkflow(w, id)
}

func activateWorkflow(w http.ResponseWriter, id int) {
	_, err := db.Exec("UPDATE workflows SET active = CASE WHEN id = ? THEN 1 ELSE active END WHERE id = ?", id, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "activated"})
}

func deleteWorkflow(w http.ResponseWriter, id int) {
	_, err := db.Exec("DELETE FROM workflows WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// --- Einstellungen ---

func handleEinstellungen(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Key required", http.StatusBadRequest)
		return
	}
	key := parts[3]

	switch r.Method {
	case "GET":
		var value string
		err := db.QueryRow("SELECT value FROM einstellungen WHERE key = ?", key).Scan(&value)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"value": ""})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"value": value})

	case "PUT":
		var body struct {
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		db.Exec("INSERT OR REPLACE INTO einstellungen (key, value) VALUES (?, ?)", key, body.Value)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "saved"})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// --- Database Admin ---

type SQLRequest struct {
	Query string `json:"query"`
}

type SQLResponse struct {
	Columns []string        `json:"columns"`
	Rows    [][]interface{} `json:"rows"`
	Error   string          `json:"error,omitempty"`
	Affected int64          `json:"affected,omitempty"`
	Type    string          `json:"type"` // "select" or "exec"
}

func handleDBTables(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		rows.Scan(&name)
		tables = append(tables, name)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tables)
}

func handleDBQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SQLRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := strings.TrimSpace(req.Query)
	if query == "" {
		http.Error(w, "Empty query", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	upperQuery := strings.ToUpper(query)
	isSelect := strings.HasPrefix(upperQuery, "SELECT") || strings.HasPrefix(upperQuery, "PRAGMA")

	if isSelect {
		rows, err := db.Query(query)
		if err != nil {
			json.NewEncoder(w).Encode(SQLResponse{Error: err.Error(), Type: "select"})
			return
		}
		defer rows.Close()

		cols, _ := rows.Columns()
		var resultRows [][]interface{}

		for rows.Next() {
			values := make([]interface{}, len(cols))
			valuePtrs := make([]interface{}, len(cols))
			for i := range values {
				valuePtrs[i] = &values[i]
			}
			rows.Scan(valuePtrs...)

			row := make([]interface{}, len(cols))
			for i, v := range values {
				if b, ok := v.([]byte); ok {
					row[i] = string(b)
				} else {
					row[i] = v
				}
			}
			resultRows = append(resultRows, row)
		}

		if resultRows == nil {
			resultRows = [][]interface{}{}
		}

		json.NewEncoder(w).Encode(SQLResponse{Columns: cols, Rows: resultRows, Type: "select"})
	} else {
		result, err := db.Exec(query)
		if err != nil {
			json.NewEncoder(w).Encode(SQLResponse{Error: err.Error(), Type: "exec"})
			return
		}
		affected, _ := result.RowsAffected()

		// Trigger workflows and check Durchführung status on UPDATE messungen
		if strings.Contains(upperQuery, "UPDATE") && strings.Contains(upperQuery, "MESSUNGEN") {
			go triggerWorkflowsForUpdatedMessungen(query)
			// Check if messergebnis was set → mark Durchführung as gemessen
			if strings.Contains(upperQuery, "MESSERGEBNIS") {
				go func() {
					// Extract ID
					idStr := extractIDFromQuery(query)
					if id, err := strconv.Atoi(idStr); err == nil {
						checkAndMarkGemessen(id)
					}
				}()
			}
		}

		json.NewEncoder(w).Encode(SQLResponse{Type: "exec", Affected: affected})
	}
}

func extractIDFromQuery(query string) string {
	upper := strings.ToUpper(query)
	idIdx := strings.Index(upper, "WHERE ID =")
	if idIdx == -1 {
		idIdx = strings.Index(upper, "WHERE ID=")
	}
	if idIdx == -1 {
		return ""
	}
	rest := strings.TrimSpace(query[idIdx+10:])
	idStr := ""
	for _, ch := range rest {
		if ch >= '0' && ch <= '9' {
			idStr += string(ch)
		} else {
			break
		}
	}
	return idStr
}

func triggerWorkflowsForUpdatedMessungen(query string) {
	// Extract ID from WHERE clause (e.g., "WHERE id = 5")
	upper := strings.ToUpper(query)
	idIdx := strings.Index(upper, "WHERE ID =")
	if idIdx == -1 {
		idIdx = strings.Index(upper, "WHERE ID=")
	}
	if idIdx == -1 {
		return
	}

	// Extract the ID value
	rest := strings.TrimSpace(query[idIdx+10:])
	rest = strings.TrimSpace(rest)
	idStr := ""
	for _, ch := range rest {
		if ch >= '0' && ch <= '9' {
			idStr += string(ch)
		} else {
			break
		}
	}
	if idStr == "" {
		return
	}

	// Load the full messung data
	row, err := db.Query("SELECT * FROM messungen WHERE id = " + idStr)
	if err != nil {
		return
	}
	defer row.Close()

	cols, _ := row.Columns()
	if !row.Next() {
		return
	}

	values := make([]interface{}, len(cols))
	valuePtrs := make([]interface{}, len(cols))
	for i := range values {
		valuePtrs[i] = &values[i]
	}
	row.Scan(valuePtrs...)

	data := make(map[string]interface{})
	for i, col := range cols {
		if b, ok := values[i].([]byte); ok {
			data[col] = string(b)
		} else {
			data[col] = values[i]
		}
	}

	ProcessMessungWorkflows(data)
}

// --- Health ---

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func main() {
	port := "8080"
	if len(os.Args) > 1 {
		port = os.Args[1]
	}

	initDB()
	defer db.Close()
	initWorkflowLogs()
	initSMTPConfig()

	http.HandleFunc("/api/messungen", corsMiddleware(handleMessungen))
	http.HandleFunc("/api/messungen/", corsMiddleware(handleMessungByID))
	http.HandleFunc("/api/dropdowns", corsMiddleware(handleDropdowns))
	http.HandleFunc("/api/dropdowns/", corsMiddleware(handleDropdownByID))
	http.HandleFunc("/api/formulare", corsMiddleware(handleFormulare))
	http.HandleFunc("/api/formulare/", corsMiddleware(handleFormularByID))
	http.HandleFunc("/api/durchfuehrungen", corsMiddleware(handleDurchfuehrungen))
	http.HandleFunc("/api/durchfuehrungen/", corsMiddleware(handleDurchfuehrungByID))
	http.HandleFunc("/api/pruefplan", corsMiddleware(handlePruefplan))
	http.HandleFunc("/api/pruefplan/", corsMiddleware(handlePruefplanByID))
	http.HandleFunc("/api/workflows", corsMiddleware(handleWorkflows))
	http.HandleFunc("/api/workflows/", corsMiddleware(handleWorkflowByID))
	http.HandleFunc("/api/einstellungen/", corsMiddleware(handleEinstellungen))
	http.HandleFunc("/api/db/tables", corsMiddleware(handleDBTables))
	http.HandleFunc("/api/db/query", corsMiddleware(handleDBQuery))
	http.HandleFunc("/api/health", corsMiddleware(handleHealth))

	fmt.Printf("Magna Server gestartet auf Port %s\n", port)
	fmt.Printf("API erreichbar unter: http://localhost:%s/api/\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
