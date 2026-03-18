package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type App struct {
	ctx       context.Context
	serverURL string
}

type Messung struct {
	ID                 int    `json:"id"`
	Datum              string `json:"datum"`
	Fertigungsbereich  string `json:"fertigungsbereich"`
	AbteilungZSB       string `json:"abteilung_zsb"`
	AbteilungUZSB      string `json:"abteilung_uzsb"`
	Name               string `json:"name"`
	BatchNr            string `json:"batch_nr"`
	Station            string `json:"station"`
	Pruefzweck         string `json:"pruefzweck"`
	Pruefart           string `json:"pruefart"`
	Einstellmassnahme  string `json:"einstellmassnahme"`
	NokID              string `json:"nok_id"`
	Bemerkungen        string `json:"bemerkungen"`
	MessungPlanmaessig string `json:"messung_planmaessig"`
	Ausgeschleust      string `json:"ausgeschleust"`
	ErstelltAm         string `json:"erstellt_am"`
}

func NewApp() *App {
	serverURL := "http://localhost:8080"
	if data, err := os.ReadFile("config.txt"); err == nil {
		url := strings.TrimSpace(string(data))
		if url != "" {
			serverURL = url
		}
	}
	return &App{serverURL: serverURL}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) GetMessungen() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/messungen")
	if err != nil {
		return fmt.Sprintf(`{"error": "Server nicht erreichbar: %s"}`, err.Error())
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	return string(body)
}

func (a *App) DeleteMessung(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/messungen/%d", a.serverURL, id), nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

func (a *App) CheckConnection() string {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/health")
	if err != nil {
		return fmt.Sprintf("Fehler: Server nicht erreichbar (%s)", a.serverURL)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return "OK"
	}
	return "Fehler: Server antwortet nicht korrekt"
}

// --- Dropdown Verwaltung ---

func (a *App) GetDropdowns(kategorie string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	url := a.serverURL + "/api/dropdowns"
	if kategorie != "" {
		url += "?kategorie=" + kategorie
	}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) AddDropdown(kategorie, wert string, position int) string {
	data := fmt.Sprintf(`{"kategorie":"%s","wert":"%s","position":%d}`, kategorie, wert, position)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/dropdowns", "application/json", strings.NewReader(data))
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusCreated {
		return "OK"
	}
	body, _ := io.ReadAll(resp.Body)
	return fmt.Sprintf("Fehler: %s", string(body))
}

func (a *App) DeleteDropdown(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/dropdowns/%d", a.serverURL, id), nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

// --- Formular Verwaltung ---

func (a *App) GetActiveFormular() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/formulare/active")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) GetFormulare() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/formulare")
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) GetFormular(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("%s/api/formulare/%d", a.serverURL, id))
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) SaveFormular(jsonData string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/formulare", "application/json", strings.NewReader(jsonData))
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) UpdateFormular(id int, jsonData string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/api/formulare/%d", a.serverURL, id), strings.NewReader(jsonData))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) ActivateFormular(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(fmt.Sprintf("%s/api/formulare/%d/activate", a.serverURL, id), "application/json", nil)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) DeleteFormular(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/formulare/%d", a.serverURL, id), nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

// --- Workflow Verwaltung ---

func (a *App) GetWorkflows() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/workflows")
	if err != nil {
		return "[]"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) GetWorkflow(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("%s/api/workflows/%d", a.serverURL, id))
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) SaveWorkflow(jsonData string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/workflows", "application/json", strings.NewReader(jsonData))
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) UpdateWorkflow(id int, jsonData string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/api/workflows/%d", a.serverURL, id), strings.NewReader(jsonData))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf(`{"error": "%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) DeleteWorkflow(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/workflows/%d", a.serverURL, id), nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

// --- Einstellungen ---

func (a *App) GetSetting(key string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/einstellungen/" + key)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) SaveSetting(key string, value string) string {
	payload := fmt.Sprintf(`{"value":%s}`, strconv.Quote(value))
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("PUT", a.serverURL+"/api/einstellungen/"+key, strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

// --- Prüfplan ---

func (a *App) GetPruefplan() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/pruefplan")
	if err != nil {
		return "[]"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) SavePruefplanEntry(jsonData string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/pruefplan", "application/json", strings.NewReader(jsonData))
	if err != nil {
		return fmt.Sprintf(`{"error":"%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) UpdatePruefplanEntry(id int, jsonData string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/api/pruefplan/%d", a.serverURL, id), strings.NewReader(jsonData))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf(`{"error":"%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) DeletePruefplanEntry(id int) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/pruefplan/%d", a.serverURL, id), nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

// --- Durchführungen ---

func (a *App) GetDurchfuehrungen(status string, datum string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	url := a.serverURL + "/api/durchfuehrungen"
	params := []string{}
	if status != "" {
		params = append(params, "status="+status)
	}
	if datum != "" {
		params = append(params, "datum="+datum)
	}
	if len(params) > 0 {
		url += "?" + strings.Join(params, "&")
	}
	resp, err := client.Get(url)
	if err != nil {
		return "[]"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

// --- Database Admin ---

func (a *App) GetDBTables() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/db/tables")
	if err != nil {
		return "[]"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) ExecuteSQL(query string) string {
	payload := fmt.Sprintf(`{"query":%s}`, strconv.Quote(query))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/db/query", "application/json", strings.NewReader(payload))
	if err != nil {
		return fmt.Sprintf(`{"error":"%s"}`, err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (a *App) ExportCSV() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/messungen")
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var messungen []Messung
	if err := json.Unmarshal(body, &messungen); err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}

	csv := "ID;Datum;Fertigungsbereich;Abteilung ZSB;Abteilung UZSB;Name;Batch-Nr;Station;Prüfzweck;Prüfart;Einstellmaßnahme;NOK-ID;Bemerkungen;Planmäßig;Ausgeschleust;Erstellt am\n"
	for _, m := range messungen {
		csv += fmt.Sprintf("%d;%s;%s;%s;%s;%s;%s;%s;%s;%s;%s;%s;%s;%s;%s;%s\n",
			m.ID, m.Datum, m.Fertigungsbereich, m.AbteilungZSB, m.AbteilungUZSB,
			m.Name, m.BatchNr, m.Station, m.Pruefzweck, m.Pruefart,
			m.Einstellmassnahme, m.NokID, m.Bemerkungen,
			m.MessungPlanmaessig, m.Ausgeschleust, m.ErstelltAm)
	}

	filename := fmt.Sprintf("messungen_export_%s.csv", time.Now().Format("2006-01-02_15-04-05"))
	if err := os.WriteFile(filename, []byte(csv), 0644); err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	return fmt.Sprintf("OK:%s", filename)
}
