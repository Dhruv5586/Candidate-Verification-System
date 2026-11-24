package store

import (
	"errors"
	"sync"
	"time"
)

var (
	// ErrTransactionNotFound indicates the state parameter does not match any active transaction.
	ErrTransactionNotFound = errors.New("oauth transaction not found: invalid or missing state")

	// ErrTransactionExpired indicates the transaction window has elapsed.
	ErrTransactionExpired = errors.New("oauth transaction has expired")

	// ErrTransactionAlreadyConsumed indicates an attempt to reuse an authorization transaction (replay attack).
	ErrTransactionAlreadyConsumed = errors.New("oauth transaction has already been used: potential replay detected")
)

// OAuthTransaction holds temporary state generated during /auth/google/login.
type OAuthTransaction struct {
	State        string
	Nonce        string
	PKCEVerifier string
	CreatedAt    time.Time
	ExpiresAt    time.Time
	Consumed     bool
}

// TransactionStore defines the contract for temporary OAuth transaction persistence.
type TransactionStore interface {
	// Save stores a new OAuth transaction associated with a unique state key.
	Save(state string, tx *OAuthTransaction) error

	// GetAndConsume retrieves the transaction and marks it as consumed in a single atomic operation.
	GetAndConsume(state string) (*OAuthTransaction, error)

	// Close releases any background resources.
	Close()
}

// MemoryTransactionStore provides an in-memory, thread-safe implementation of TransactionStore.
//
// ARCHITECTURAL LIMITATIONS:
// 1. Ephemeral: All pending OAuth transactions are lost if the server process restarts.
// 2. Single-Instance: Does not support horizontal scaling across multiple instances without sticky sessions.
// 3. In Phase 3+, this will be complemented or replaced by distributed persistence (e.g., Redis / PostgreSQL).
type MemoryTransactionStore struct {
	mu           sync.Mutex
	transactions map[string]*OAuthTransaction
	stopCleanup  chan struct{}
}

// NewMemoryTransactionStore initializes an in-memory store and starts a periodic cleanup worker.
func NewMemoryTransactionStore(cleanupInterval time.Duration) *MemoryTransactionStore {
	store := &MemoryTransactionStore{
		transactions: make(map[string]*OAuthTransaction),
		stopCleanup:  make(chan struct{}),
	}

	// Start background routine to prune expired entries
	go store.cleanupLoop(cleanupInterval)

	return store
}

// Save inserts or updates a transaction under the given state key.
func (m *MemoryTransactionStore) Save(state string, tx *OAuthTransaction) error {
	if state == "" || tx == nil {
		return errors.New("state and transaction must not be empty")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.transactions[state] = tx
	return nil
}

// GetAndConsume retrieves a transaction, verifies expiration and single-use, and marks it consumed atomically.
func (m *MemoryTransactionStore) GetAndConsume(state string) (*OAuthTransaction, error) {
	if state == "" {
		return nil, ErrTransactionNotFound
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	tx, exists := m.transactions[state]
	if !exists {
		return nil, ErrTransactionNotFound
	}

	// Check single-use status
	if tx.Consumed {
		return nil, ErrTransactionAlreadyConsumed
	}

	// Check expiration
	if time.Now().After(tx.ExpiresAt) {
		delete(m.transactions, state)
		return nil, ErrTransactionExpired
	}

	// Mark consumed immediately to prevent replay
	tx.Consumed = true
	// Delete from active map to free memory
	delete(m.transactions, state)

	return tx, nil
}

// Close stops the periodic cleanup worker.
func (m *MemoryTransactionStore) Close() {
	close(m.stopCleanup)
}

func (m *MemoryTransactionStore) cleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.pruneExpired()
		case <-m.stopCleanup:
			return
		}
	}
}

func (m *MemoryTransactionStore) pruneExpired() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for state, tx := range m.transactions {
		if now.After(tx.ExpiresAt) || tx.Consumed {
			delete(m.transactions, state)
		}
	}
}
