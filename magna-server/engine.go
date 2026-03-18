package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/smtp"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type WorkflowDef struct {
	Nodes []WorkflowNode `json:"nodes"`
}

type WorkflowNode struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Label    string `json:"label"`
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
	Event    string `json:"event"`
	// Email
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	Mode    string `json:"mode"`
	// Delay
	Duration int    `json:"duration"`
	Unit     string `json:"unit"`
	// Set Value / User Input
	TargetColumn string   `json:"target_column"`
	SetValue     string   `json:"set_value"`
	PromptText   string   `json:"prompt_text"`
	InputType    string   `json:"input_type"`
	InputOptions []string `json:"input_options"`
	// Condition branches
	YesNodes []WorkflowNode `json:"yes_nodes"`
	NoNodes  []WorkflowNode `json:"no_nodes"`
}

// SMTP config from smtp.conf
type SMTPConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	From     string
}

var smtpConfig SMTPConfig

func initSMTPConfig() {
	// Defaults
	smtpConfig = SMTPConfig{
		Host: "localhost",
		Port: "587",
		From: "magna@localhost",
	}

	data, err := os.ReadFile("smtp.conf")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		switch key {
		case "SMTP_HOST":
			smtpConfig.Host = val
		case "SMTP_PORT":
			smtpConfig.Port = val
		case "SMTP_USER":
			smtpConfig.User = val
		case "SMTP_PASSWORD":
			smtpConfig.Password = val
		case "SMTP_FROM":
			smtpConfig.From = val
		}
	}
	log.Printf("SMTP konfiguriert: %s:%s", smtpConfig.Host, smtpConfig.Port)
}

func initWorkflowLogs() {
	db.Exec(`CREATE TABLE IF NOT EXISTS workflow_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		workflow_id INTEGER NOT NULL,
		messung_id INTEGER,
		node_id TEXT,
		node_type TEXT,
		status TEXT,
		details TEXT,
		erstellt_am TEXT NOT NULL
	)`)
}

// ProcessMessungWorkflows checks all active workflows against a messung
func ProcessMessungWorkflows(messungData map[string]interface{}) {
	rows, err := db.Query("SELECT id, name, definition FROM workflows WHERE active = 1")
	if err != nil {
		log.Printf("Workflow engine error: %s", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var wfID int
		var wfName, defJSON string
		rows.Scan(&wfID, &wfName, &defJSON)

		var def WorkflowDef
		if err := json.Unmarshal([]byte(defJSON), &def); err != nil {
			log.Printf("Workflow %d parse error: %s", wfID, err)
			continue
		}

		go executeWorkflow(wfID, wfName, def.Nodes, messungData)
	}
}

func executeWorkflow(wfID int, wfName string, nodes []WorkflowNode, data map[string]interface{}) {
	messungID := getIntFromData(data, "id")

	for _, node := range nodes {
		switch node.Type {
		case "trigger":
			if !evaluateCondition(node, data) {
				logWorkflow(wfID, messungID, node.ID, "trigger", "skipped",
					fmt.Sprintf("Bedingung nicht erfüllt: %s %s %s", node.Field, node.Operator, node.Value))
				return
			}
			logWorkflow(wfID, messungID, node.ID, "trigger", "triggered",
				fmt.Sprintf("Workflow '%s' ausgelöst", wfName))

		case "condition":
			if !evaluateCondition(node, data) {
				logWorkflow(wfID, messungID, node.ID, "condition", "false",
					fmt.Sprintf("%s %s %s", node.Field, node.Operator, node.Value))
				if len(node.NoNodes) > 0 {
					executeWorkflow(wfID, wfName, node.NoNodes, data)
				}
				return
			}
			logWorkflow(wfID, messungID, node.ID, "condition", "true",
				fmt.Sprintf("%s %s %s", node.Field, node.Operator, node.Value))
			if len(node.YesNodes) > 0 {
				executeWorkflow(wfID, wfName, node.YesNodes, data)
			}

		case "email":
			err := executeEmail(node, data)
			if err != nil {
				logWorkflow(wfID, messungID, node.ID, "email", "error", err.Error())
			} else {
				logWorkflow(wfID, messungID, node.ID, "email", "executed",
					fmt.Sprintf("An: %s (%s)", node.To, node.Mode))
			}

		case "set_value":
			if node.TargetColumn != "" && messungID > 0 {
				val := replacePlaceholders(node.SetValue, data)
				// Handle {{today}} placeholder
				if strings.Contains(val, "{{today}}") {
					val = strings.ReplaceAll(val, "{{today}}", time.Now().Format("2006-01-02 15:04:05"))
				}
				escaped := strings.ReplaceAll(val, "'", "''")
				_, err := db.Exec(fmt.Sprintf("UPDATE messungen SET %s = '%s' WHERE id = %d",
					node.TargetColumn, escaped, messungID))
				if err != nil {
					logWorkflow(wfID, messungID, node.ID, "set_value", "error", err.Error())
				} else {
					logWorkflow(wfID, messungID, node.ID, "set_value", "executed",
						fmt.Sprintf("%s = '%s'", node.TargetColumn, val))
				}
			}

		case "user_input":
			// User input nodes create a pending task that the frontend will resolve
			logWorkflow(wfID, messungID, node.ID, "user_input", "pending",
				fmt.Sprintf("Warte auf Eingabe: %s → %s", node.PromptText, node.TargetColumn))

		case "delay":
			duration := calculateDelay(node)
			logWorkflow(wfID, messungID, node.ID, "delay", "waiting",
				fmt.Sprintf("%d %s", node.Duration, node.Unit))
			time.Sleep(duration)
			logWorkflow(wfID, messungID, node.ID, "delay", "completed", "Abgeschlossen")
		}
	}

	log.Printf("[Workflow %d] '%s' abgeschlossen für Messung %d", wfID, wfName, messungID)
}

func evaluateCondition(node WorkflowNode, data map[string]interface{}) bool {
	fieldVal := ""
	if v, ok := data[node.Field]; ok && v != nil {
		fieldVal = fmt.Sprintf("%v", v)
	}

	switch node.Operator {
	case "equals":
		return strings.EqualFold(fieldVal, node.Value)
	case "not_equals":
		return !strings.EqualFold(fieldVal, node.Value)
	case "contains":
		return strings.Contains(strings.ToLower(fieldVal), strings.ToLower(node.Value))
	case "not_empty":
		return fieldVal != ""
	case "empty":
		return fieldVal == ""
	case "greater":
		return fieldVal > node.Value
	case "less":
		return fieldVal < node.Value
	default:
		return false
	}
}

func executeEmail(node WorkflowNode, data map[string]interface{}) error {
	subject := replacePlaceholders(node.Subject, data)
	body := replacePlaceholders(node.Body, data)
	to := replacePlaceholders(node.To, data)

	if node.Mode == "outlook" {
		return openOutlookEmail(to, subject, body)
	}
	return sendSMTPEmail(to, subject, body)
}

func replacePlaceholders(text string, data map[string]interface{}) string {
	result := text
	for key, val := range data {
		placeholder := "{{" + key + "}}"
		result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", val))
	}
	return result
}

func sendSMTPEmail(to, subject, body string) error {
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		smtpConfig.From, to, subject, body)

	var auth smtp.Auth
	if smtpConfig.User != "" {
		auth = smtp.PlainAuth("", smtpConfig.User, smtpConfig.Password, smtpConfig.Host)
	}

	return smtp.SendMail(smtpConfig.Host+":"+smtpConfig.Port, auth, smtpConfig.From, []string{to}, []byte(msg))
}

func openOutlookEmail(to, subject, body string) error {
	mailto := fmt.Sprintf("mailto:%s?subject=%s&body=%s",
		to, url.QueryEscape(subject), url.QueryEscape(body))

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", mailto)
	case "darwin":
		cmd = exec.Command("open", mailto)
	default:
		cmd = exec.Command("xdg-open", mailto)
	}
	return cmd.Start()
}

func calculateDelay(node WorkflowNode) time.Duration {
	d := time.Duration(node.Duration)
	switch node.Unit {
	case "minutes":
		return d * time.Minute
	case "hours":
		return d * time.Hour
	case "days":
		return d * 24 * time.Hour
	default:
		return d * time.Minute
	}
}

func getIntFromData(data map[string]interface{}, key string) int {
	if v, ok := data[key]; ok {
		switch val := v.(type) {
		case float64:
			return int(val)
		case int64:
			return int(val)
		case int:
			return val
		}
	}
	return 0
}

func logWorkflow(workflowID, messungID int, nodeID, nodeType, status, details string) {
	now := time.Now().Format("2006-01-02 15:04:05")
	db.Exec(`INSERT INTO workflow_logs (workflow_id, messung_id, node_id, node_type, status, details, erstellt_am)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		workflowID, messungID, nodeID, nodeType, status, details, now)
	log.Printf("[Workflow %d] %s: %s - %s", workflowID, nodeType, status, details)
}
