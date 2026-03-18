package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type App struct {
	ctx       context.Context
	serverURL string
}

type Messung struct {
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
}

func NewApp() *App {
	serverURL := "http://localhost:8080"

	// Server-URL aus config.txt lesen falls vorhanden
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

func (a *App) SaveMessung(m Messung) string {
	jsonData, err := json.Marshal(m)
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/messungen", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Fehler: Server nicht erreichbar (%s)", err.Error())
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return fmt.Sprintf("Fehler: %s", string(body))
	}

	// Return the response which includes the ID
	return string(body)
}

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

func (a *App) MarkGebracht(durchfuehrungID int, messungID int, gebrachtVon string) string {
	payload := fmt.Sprintf(`{"messung_id":%d,"gebracht_von":"%s"}`, messungID, gebrachtVon)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(fmt.Sprintf("%s/api/durchfuehrungen/%d/gebracht", a.serverURL, durchfuehrungID),
		"application/json", strings.NewReader(payload))
	if err != nil {
		return fmt.Sprintf("Fehler: %s", err.Error())
	}
	defer resp.Body.Close()
	return "OK"
}

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

func (a *App) SaveMessungDynamic(formId int, datenJSON string) string {
	payload := fmt.Sprintf(`{"form_id":%d,"daten":%s}`, formId, datenJSON)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/messungen", "application/json", strings.NewReader(payload))
	if err != nil {
		return fmt.Sprintf("Fehler: Server nicht erreichbar (%s)", err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Sprintf("Fehler: %s", string(body))
	}
	return "OK"
}

func (a *App) GetNokIDs() string {
	payload := `{"query":"SELECT DISTINCT nok_id FROM messungen WHERE nok_id != '' ORDER BY nok_id"}`
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(a.serverURL+"/api/db/query", "application/json", strings.NewReader(payload))
	if err != nil {
		return "[]"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	// Parse and return just the values as array
	var result struct {
		Rows [][]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "[]"
	}
	var ids []string
	for _, row := range result.Rows {
		if len(row) > 0 && row[0] != nil {
			ids = append(ids, fmt.Sprintf("%v", row[0]))
		}
	}
	jsonBytes, _ := json.Marshal(ids)
	return string(jsonBytes)
}

func (a *App) GetDropdowns(kategorie string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(a.serverURL + "/api/dropdowns?kategorie=" + kategorie)
	if err != nil {
		return "[]"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
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
