package logx

import (
	"log"
	"os"
	"strings"
)

// Verbose enables per-symbol and step-by-step logs. Default: on.
// Set LOG_VERBOSE=false to reduce noise.
var Verbose = true

func init() {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_VERBOSE"))) {
	case "0", "false", "off", "no":
		Verbose = false
	case "1", "true", "on", "yes":
		Verbose = true
	}
}

func Info(format string, args ...any) {
	log.Printf("[INFO] "+format, args...)
}

func Warn(format string, args ...any) {
	log.Printf("[WARN] "+format, args...)
}

func Error(format string, args ...any) {
	log.Printf("[ERROR] "+format, args...)
}

func Verbosef(format string, args ...any) {
	if Verbose {
		log.Printf("[VERBOSE] "+format, args...)
	}
}
