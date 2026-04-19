package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

var cachedDb *mongo.Client

func connectToDatabase(uri string) (*mongo.Client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if cachedDb != nil {
		if err := cachedDb.Ping(ctx, readpref.Primary()); err == nil {
			return cachedDb, nil
		}
	}

	opts := options.Client().ApplyURI(uri).
		SetConnectTimeout(10 * time.Second).
		SetSocketTimeout(45 * time.Second).
		SetServerSelectionTimeout(5 * time.Second)

	client, err := mongo.Connect(ctx, opts)
	if err != nil {
		log.Printf("MongoDB connection error: %v", err)
		cachedDb = nil
		return nil, err
	}

	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		log.Printf("MongoDB ping error: %v", err)
		cachedDb = nil
		return nil, err
	}

	cachedDb = client
	log.Println("MongoDB connected successfully")
	return client, nil
}

// Middleware: ensure database connection
func dbMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uri := os.Getenv("MONGODB_URI")
		if uri == "" {
			uri = "mongodb://localhost:27017/order-system"
		}
		if _, err := connectToDatabase(uri); err != nil {
			http.Error(w, `{"success":false,"message":"Database connection failed"}`, http.StatusInternalServerError)
			return
		}
		
		// ReservationReaperService.kickFromRequest() equivalent would go here
		
		next.ServeHTTP(w, r)
	})
}

// Handler for Paystack Webhook
func paystackWebhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// We read raw body just like express.raw()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Implement OrderController.paystackWebhook logic here
	log.Printf("Received raw webhook payload of %d bytes", len(body))
	w.WriteHeader(http.StatusOK)
}

// Root handler
func rootHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Order Management API",
		"version": "1.0.0",
		"endpoints": map[string]string{
			"users":     "/api/users",
			"products":  "/api/products",
			"inventory": "/api/inventory",
			"cart":      "/api/cart",
			"orders":    "/api/orders",
			"wallets":   "/api/wallets",
			"storage":   "/api/storage",
		},
	})
}

// Health handler
func healthHandler(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if cachedDb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := cachedDb.Ping(ctx, readpref.Primary()); err == nil {
			dbStatus = "connected"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"status":    "healthy",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"database":  dbStatus,
	})
}

// Dummy handler for routed sub-paths
func dummyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Hit route: %s", r.URL.Path),
	})
}

func main() {
	// Equivalent of dotenv/config would be calling a package like github.com/joho/godotenv
	// godotenv.Load()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	mux := http.NewServeMux()

	// Base endpoints
	mux.HandleFunc("/", rootHandler)
	mux.HandleFunc("/health", healthHandler)

	// Webhook endpoint (Raw body)
	mux.HandleFunc("/api/orders/webhook/paystack", paystackWebhookHandler)

	// API Routes (Stubs)
	mux.HandleFunc("/api/users/", dummyHandler)
	mux.HandleFunc("/api/products/", dummyHandler)
	mux.HandleFunc("/api/inventory/", dummyHandler)
	mux.HandleFunc("/api/cart/", dummyHandler)
	mux.HandleFunc("/api/orders/", dummyHandler)
	mux.HandleFunc("/api/wallets/", dummyHandler)
	mux.HandleFunc("/api/storage/", dummyHandler)

	// Wrap mux with global middleware
	var handler http.Handler = mux

	// 1. DB Middleware
	handler = dbMiddleware(handler)

	// NOTE: Additional middlewares like CORS, body size limits, CSRF protection,
	// and OG bot interception would be chained here, using appropriate Go packages.

	// Background Reaper interval
	env := os.Getenv("NODE_ENV")
	if env != "production" {
		uri := os.Getenv("MONGODB_URI")
		if uri == "" {
			uri = "mongodb://localhost:27017/order-system"
		}
		
		if _, err := connectToDatabase(uri); err != nil {
			log.Fatalf("Failed to connect database at startup: %v", err)
		}

		if os.Getenv("DISABLE_RESERVATION_REAPER") != "true" {
			interval, _ := strconv.Atoi(os.Getenv("RESERVATION_REAPER_INTERVAL_MS"))
			if interval <= 0 {
				interval = 60000 // 60 seconds
			}

			go func() {
				ticker := time.NewTicker(time.Duration(interval) * time.Millisecond)
				defer ticker.Stop()
				for range ticker.C {
					// ReservationReaperService.runOnce logic
					log.Println("Running reaper interval...")
				}
			}()
		}
	}

	log.Printf("Server running on port %s (env: %s)", port, env)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}


// Failed to find the "go" binary in either GOROOT() or PATH(C:\Windows\system32;C:\Windows;C:\Windows\System32\Wbem;C:\Windows\System32\WindowsPowerShell\v1.0\;C:\Windows\System32\OpenSSH\;C:\Program Files\Git\cmd;C:\Program Files\nodejs\;C:\Program Files\GitHub CLI\;C:\Users\hp\AppData\Local\Microsoft\WindowsApps;;C:\Users\hp\AppData\Local\Programs\Microsoft VS Code\bin;C:\Users\hp\AppData\Roaming\npm;C:\Users\hp\AppData\Local\Programs\Antigravity\bin;C:\Users\hp\AppData\Local\Programs\Kiro\bin;C:\Users\hp\AppData\Local\Programs\cursor\resources\app\bin). Check PATH, or Install Go and reload the window. If PATH isn't what you expected, see https://github.com/golang/vscode-go/issues/971