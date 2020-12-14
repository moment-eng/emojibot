package main

import (
	"fmt"
	"net/http"

	"github.com/moment-eng/emojibot/internal/env"
)

func main() {
	http.HandleFunc("/healthcheck", HealthCheck)
	http.HandleFunc("/", HelloServer)

	fmt.Println("Serving on 0:8080")
	http.ListenAndServe(":8080", nil)
}

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	result, _ := env.GetBoolOrDefault("FAIL_HEALTHCHECK", false)

	if result {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Failing health checks 😭\n"))
		return
	}

	fmt.Fprintf(w, "🆗\n")
}

func HelloServer(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello, %s! This is 🌱", r.URL.Path[1:])
}
