package crypto

import (
	"crypto/rand"
	"encoding/hex"
)

func GenerateKey(size int) (string, error) {
	key := make([]byte, size)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return hex.EncodeToString(key), nil
}
