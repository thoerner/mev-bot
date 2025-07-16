package main

import (
	"context"
	"fmt"
	"log"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/rpc"
)

func main() {
	client, err := rpc.DialContext(context.Background(), "ws://127.0.0.1:9650/ext/bc/C/ws")
	if err != nil {
		log.Fatalf("Failed to connect to the WebSocket endpoint: %v", err)
	}
	defer client.Close()

	fmt.Println("Successfully connected to the WebSocket endpoint.")

	ctx := context.Background()
	ch := make(chan common.Hash)

	sub, err := client.EthSubscribe(ctx, ch, "newPendingTransactions")
	if err != nil {
		log.Fatalf("Failed to subscribe to pending transactions: %v", err)
	}
	defer sub.Unsubscribe()

	fmt.Println("Subscribed to pending transactions. Waiting...")

	for {
		select {
		case err := <-sub.Err():
			log.Fatalf("Subscription error: %v", err)
		case txHash := <-ch:
			fmt.Printf("New pending transaction hash: %s\n", txHash.Hex())
		}
	}
}
