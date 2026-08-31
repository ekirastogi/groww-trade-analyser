// One-time: set Firebase custom claim { role: "authenticated" } for all users.
// Required for Supabase Firebase Third-Party Auth + RLS.
//
// Usage (from backend/):
//
//	GOOGLE_APPLICATION_CREDENTIALS=~/.config/kairo/service-account.json go run ./cmd/set-firebase-claims
package main

import (
	"context"
	"fmt"
	"os"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/iterator"
)

func main() {
	ctx := context.Background()
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "firebase app: %v\n", err)
		os.Exit(1)
	}

	client, err := app.Auth(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "firebase auth: %v\n", err)
		os.Exit(1)
	}

	updated := 0
	iter := client.Users(ctx, "")
	for {
		user, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "list users: %v\n", err)
			os.Exit(1)
		}
		if role, _ := user.CustomClaims["role"].(string); role == "authenticated" {
			continue
		}
		claims := map[string]interface{}{"role": "authenticated"}
		for k, v := range user.CustomClaims {
			if k != "role" {
				claims[k] = v
			}
		}
		if err := client.SetCustomUserClaims(ctx, user.UID, claims); err != nil {
			fmt.Fprintf(os.Stderr, "set claims %s: %v\n", user.UID, err)
			os.Exit(1)
		}
		updated++
		label := user.Email
		if label == "" {
			label = user.UID
		}
		fmt.Printf("Set role=authenticated for %s\n", label)
	}

	fmt.Printf("Done. Updated %d user(s). Sign out and sign in again in the app.\n", updated)
}
