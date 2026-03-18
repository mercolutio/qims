package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func triggerPruefplanWorkflows(eventType string, durchfuehrungID int, messungID int) {
	rows, err := db.Query("SELECT id, name, definition FROM workflows WHERE active = 1")
	if err != nil {
		return
	}
	defer rows.Close()

	// Load messung data if available
	data := make(map[string]interface{})
	if messungID > 0 {
		mRow, err := db.Query("SELECT * FROM messungen WHERE id = ?", messungID)
		if err == nil {
			defer mRow.Close()
			cols, _ := mRow.Columns()
			if mRow.Next() {
				values := make([]interface{}, len(cols))
				valuePtrs := make([]interface{}, len(cols))
				for i := range values {
					valuePtrs[i] = &values[i]
				}
				mRow.Scan(valuePtrs...)
				for i, col := range cols {
					if b, ok := values[i].([]byte); ok {
						data[col] = string(b)
					} else {
						data[col] = values[i]
					}
				}
			}
		}
	}

	for rows.Next() {
		var wfID int
		var wfName, defJSON string
		rows.Scan(&wfID, &wfName, &defJSON)

		var def WorkflowDef
		if err := json.Unmarshal([]byte(defJSON), &def); err != nil {
			continue
		}

		if len(def.Nodes) == 0 {
			continue
		}

		trigger := def.Nodes[0]
		if trigger.Type != "trigger" || trigger.Event != eventType {
			continue
		}

		log.Printf("[Workflow %d] Prüfplan-Trigger '%s' ausgelöst", wfID, eventType)
		go executeWorkflow(wfID, wfName, def.Nodes[1:], data)
	}
}

func checkSchichtKomplett() {
	today := time.Now().Format("2006-01-02")
	var total, gemessen int
	db.QueryRow("SELECT COUNT(*), SUM(CASE WHEN status = 'gemessen' THEN 1 ELSE 0 END) FROM pruefplan_durchfuehrungen WHERE faelligkeit_datum = ?", today).
		Scan(&total, &gemessen)

	if total > 0 && total == gemessen {
		log.Printf("Alle %d Prüfungen der Schicht sind erledigt!", total)
		triggerPruefplanWorkflows("schicht_komplett", 0, 0)
	}
}

func generateDurchfuehrungen() {
	rows, err := db.Query("SELECT id, haeufigkeit, naechste_faelligkeit, ziel_uhrzeit FROM pruefplan WHERE aktiv = 1")
	if err != nil {
		log.Printf("Durchführungen-Generator Fehler: %s", err)
		return
	}
	defer rows.Close()

	now := time.Now()
	today := now.Format("2006-01-02")
	endDate := now.AddDate(0, 0, 7) // 7 Tage vorausgenerieren

	for rows.Next() {
		var ppID int
		var haeufigkeit, faelligkeit, zielUhrzeit string
		rows.Scan(&ppID, &haeufigkeit, &faelligkeit, &zielUhrzeit)

		if zielUhrzeit == "" {
			zielUhrzeit = "07:00"
		}

		startDate := today
		if faelligkeit != "" && faelligkeit > today {
			startDate = faelligkeit
		}

		// Generate dates based on frequency
		dates := generateDates(startDate, endDate.Format("2006-01-02"), haeufigkeit)

		for _, date := range dates {
			// Check if Durchführung already exists
			var count int
			db.QueryRow("SELECT COUNT(*) FROM pruefplan_durchfuehrungen WHERE pruefplan_id = ? AND faelligkeit_datum = ? AND faelligkeit_uhrzeit = ?",
				ppID, date, zielUhrzeit).Scan(&count)

			if count == 0 {
				db.Exec(`INSERT INTO pruefplan_durchfuehrungen (pruefplan_id, faelligkeit_datum, faelligkeit_uhrzeit, status, erstellt_am)
					VALUES (?, ?, ?, 'offen', ?)`, ppID, date, zielUhrzeit, now.Format("2006-01-02 15:04:05"))
			}
		}
	}

	log.Println("Durchführungen generiert")
}

func generateDates(start, end, haeufigkeit string) []string {
	startDate, err := time.Parse("2006-01-02", start)
	if err != nil {
		return nil
	}
	endDate, err := time.Parse("2006-01-02", end)
	if err != nil {
		return nil
	}

	var dates []string
	current := startDate

	for !current.After(endDate) {
		dates = append(dates, current.Format("2006-01-02"))

		switch haeufigkeit {
		case "pro_schicht", "taeglich":
			current = current.AddDate(0, 0, 1)
		case "woechentlich":
			current = current.AddDate(0, 0, 7)
		case "monatlich":
			current = current.AddDate(0, 1, 0)
		case "quartal":
			current = current.AddDate(0, 3, 0)
		case "jaehrlich":
			current = current.AddDate(1, 0, 0)
		default:
			current = current.AddDate(0, 0, 1)
		}
	}

	return dates
}

// API: Get Durchführungen (joined with Pruefplan data)
func handleDurchfuehrungen(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		getDurchfuehrungen(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleDurchfuehrungByID(w http.ResponseWriter, r *http.Request) {
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

	// /api/durchfuehrungen/{id}/gebracht
	if len(parts) >= 5 && parts[4] == "gebracht" && r.Method == "POST" {
		markGebracht(w, r, id)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func getDurchfuehrungen(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status") // optional filter
	datum := r.URL.Query().Get("datum")   // optional filter

	query := `SELECT d.id, d.pruefplan_id, d.messung_id, d.faelligkeit_datum, d.faelligkeit_uhrzeit,
		d.status, d.gebracht_am, d.gebracht_von, d.gemessen_am,
		p.bezeichnung, p.fertigungsbereich, p.abteilung, p.station, p.pruefart, p.haeufigkeit
		FROM pruefplan_durchfuehrungen d
		JOIN pruefplan p ON d.pruefplan_id = p.id
		WHERE 1=1`

	var args []interface{}
	if status != "" {
		query += " AND d.status = ?"
		args = append(args, status)
	}
	if datum != "" {
		query += " AND d.faelligkeit_datum = ?"
		args = append(args, datum)
	}
	query += " ORDER BY d.faelligkeit_datum ASC, d.faelligkeit_uhrzeit ASC"

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type DurchfuehrungView struct {
		ID                int     `json:"id"`
		PruefplanID       int     `json:"pruefplan_id"`
		MessungID         *int    `json:"messung_id"`
		FaelligkeitDatum  string  `json:"faelligkeit_datum"`
		FaelligkeitUhrzeit string `json:"faelligkeit_uhrzeit"`
		Status            string  `json:"status"`
		GebrachtAm        *string `json:"gebracht_am"`
		GebrachtVon       *string `json:"gebracht_von"`
		GemessenAm        *string `json:"gemessen_am"`
		Bezeichnung       string  `json:"bezeichnung"`
		Fertigungsbereich string  `json:"fertigungsbereich"`
		Abteilung         string  `json:"abteilung"`
		Station           string  `json:"station"`
		Pruefart          string  `json:"pruefart"`
		Haeufigkeit       string  `json:"haeufigkeit"`
	}

	var result []DurchfuehrungView
	for rows.Next() {
		var d DurchfuehrungView
		rows.Scan(&d.ID, &d.PruefplanID, &d.MessungID, &d.FaelligkeitDatum, &d.FaelligkeitUhrzeit,
			&d.Status, &d.GebrachtAm, &d.GebrachtVon, &d.GemessenAm,
			&d.Bezeichnung, &d.Fertigungsbereich, &d.Abteilung, &d.Station, &d.Pruefart, &d.Haeufigkeit)
		result = append(result, d)
	}

	if result == nil {
		result = []DurchfuehrungView{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func markGebracht(w http.ResponseWriter, r *http.Request, durchfuehrungID int) {
	var body struct {
		MessungID  int    `json:"messung_id"`
		GebrachtVon string `json:"gebracht_von"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := db.Exec(`UPDATE pruefplan_durchfuehrungen SET
		status = 'gebracht', messung_id = ?, gebracht_am = ?, gebracht_von = ?
		WHERE id = ?`, body.MessungID, now, body.GebrachtVon, durchfuehrungID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Also set durchfuehrung_id on the messung
	if body.MessungID > 0 {
		// Get pruefplan_id from durchfuehrung
		var ppID int
		db.QueryRow("SELECT pruefplan_id FROM pruefplan_durchfuehrungen WHERE id = ?", durchfuehrungID).Scan(&ppID)
		db.Exec("UPDATE messungen SET durchfuehrung_id = ?, pruefplan_id = ? WHERE id = ?",
			durchfuehrungID, ppID, body.MessungID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "gebracht"})

	// Trigger "bauteil_gebracht" workflows
	go triggerPruefplanWorkflows("bauteil_gebracht", durchfuehrungID, body.MessungID)
}

// Called when a messergebnis is set on a messung that has a durchfuehrung_id
func checkAndMarkGemessen(messungID int) {
	var durchfuehrungID int
	var messergebnis string

	err := db.QueryRow("SELECT COALESCE(durchfuehrung_id, 0), COALESCE(messergebnis, '') FROM messungen WHERE id = ?", messungID).
		Scan(&durchfuehrungID, &messergebnis)
	if err != nil || durchfuehrungID == 0 || messergebnis == "" {
		return
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	db.Exec(`UPDATE pruefplan_durchfuehrungen SET status = 'gemessen', gemessen_am = ? WHERE id = ?`,
		now, durchfuehrungID)
	log.Printf("Durchführung %d als gemessen markiert (Ergebnis: %s)", durchfuehrungID, messergebnis)

	// Trigger "pruefung_abgeschlossen" workflows
	go triggerPruefplanWorkflows("pruefung_abgeschlossen", durchfuehrungID, messungID)

	// Check if all Schicht-Prüfungen are done
	go checkSchichtKomplett()
}
