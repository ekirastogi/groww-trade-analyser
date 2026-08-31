package market

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const growwAPIBase = "https://api.groww.in"

type GrowwClient struct {
	httpClient *http.Client
	mu         sync.Mutex
	accessToken string
	apiKey      string
	apiSecret   string
	totp        string
}

func NewGrowwClient() (*GrowwClient, error) {
	c := &GrowwClient{
		httpClient: &http.Client{Timeout: 45 * time.Second},
		accessToken: strings.TrimSpace(os.Getenv("GROWW_ACCESS_TOKEN")),
		apiKey:      strings.TrimSpace(os.Getenv("GROWW_API_KEY")),
		apiSecret:   strings.TrimSpace(os.Getenv("GROWW_API_SECRET")),
		totp:        strings.TrimSpace(os.Getenv("GROWW_TOTP")),
	}
	if c.accessToken == "" && c.apiKey == "" {
		return nil, fmt.Errorf("set GROWW_ACCESS_TOKEN or GROWW_API_KEY (+ GROWW_API_SECRET or GROWW_TOTP)")
	}
	return c, nil
}

func (c *GrowwClient) ensureToken(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.accessToken != "" {
		return nil
	}
	if c.apiKey == "" {
		return fmt.Errorf("groww: no access token and no API key configured")
	}
	token, err := c.fetchAccessToken(ctx)
	if err != nil {
		return err
	}
	c.accessToken = token
	return nil
}

func (c *GrowwClient) fetchAccessToken(ctx context.Context) (string, error) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	var body map[string]string
	if c.totp != "" {
		body = map[string]string{
			"key_type": "totp",
			"totp":     c.totp,
		}
	} else if c.apiSecret != "" {
		sum := sha256.Sum256([]byte(c.apiSecret + timestamp))
		body = map[string]string{
			"key_type":  "approval",
			"checksum":  hex.EncodeToString(sum[:]),
			"timestamp": timestamp,
		}
	} else {
		return "", fmt.Errorf("groww: set GROWW_API_SECRET or GROWW_TOTP to mint an access token")
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, growwAPIBase+"/v1/token/api/access", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("groww auth: http %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var parsed struct {
		Token   string `json:"token"`
		Status  string `json:"status"`
		Payload struct {
			Token string `json:"token"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", err
	}
	if parsed.Token != "" {
		return parsed.Token, nil
	}
	if parsed.Payload.Token != "" {
		return parsed.Payload.Token, nil
	}
	return "", fmt.Errorf("groww auth: empty token in response")
}

type growwAPIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type growwEnvelope struct {
	Status  string          `json:"status"`
	Payload json.RawMessage `json:"payload"`
	Error   *growwAPIError  `json:"error"`
}

func (c *GrowwClient) get(ctx context.Context, path string, query url.Values, out any) error {
	if err := c.ensureToken(ctx); err != nil {
		return err
	}
	u := growwAPIBase + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-VERSION", "1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusUnauthorized && c.apiKey != "" {
		c.mu.Lock()
		c.accessToken = ""
		c.mu.Unlock()
		if err := c.ensureToken(ctx); err != nil {
			return err
		}
		return c.get(ctx, path, query, out)
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("groww api %s: http %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var env growwEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return err
	}
	if env.Status == "FAILURE" || env.Error != nil {
		if env.Error != nil {
			return fmt.Errorf("groww api %s: %s (%s)", path, env.Error.Message, env.Error.Code)
		}
		return fmt.Errorf("groww api %s: request failed", path)
	}
	if out == nil {
		return nil
	}
	if len(env.Payload) == 0 {
		return nil
	}
	return json.Unmarshal(env.Payload, out)
}

func (c *GrowwClient) post(ctx context.Context, path string, payload any, out any) error {
	if err := c.ensureToken(ctx); err != nil {
		return err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, growwAPIBase+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-VERSION", "1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("groww api %s: http %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var env growwEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return err
	}
	if env.Status == "FAILURE" || env.Error != nil {
		if env.Error != nil {
			return fmt.Errorf("groww api %s: %s (%s)", path, env.Error.Message, env.Error.Code)
		}
		return fmt.Errorf("groww api %s: request failed", path)
	}
	if out == nil || len(env.Payload) == 0 {
		return nil
	}
	return json.Unmarshal(env.Payload, out)
}
