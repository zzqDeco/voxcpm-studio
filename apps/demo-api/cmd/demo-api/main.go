package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"demo_api/internal/demoapi"
)

func main() {
	settings := demoapi.LoadSettingsFromEnv()

	app, err := demoapi.NewDemoAPI(settings)
	if err != nil {
		log.Fatalf("failed to init API: %v", err)
	}

	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", settings.APIHost, settings.APIPort),
		Handler:      app.Router(),
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("demo API listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("server stopped: %v", err)
	}
}
