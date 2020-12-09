package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/healthcheck", HealthCheck)
	http.HandleFunc("/", HelloServer)

	fmt.Println("Serving on 0:8080")
	http.ListenAndServe(":8080", nil)
}

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "🆗\n")
}

func HelloServer(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello, %s! This is 🌱", r.URL.Path[1:])
}
