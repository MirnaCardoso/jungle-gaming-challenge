#!/usr/bin/env bash
set -eo pipefail

echo "Initializing AWS SQS Queues in LocalStack..."

# Create Dead-Letter Queue (DLQ) first
awslocal sqs create-queue \
    --queue-name wager-transactions-dlq.fifo \
    --attributes FifoQueue=true,ContentBasedDeduplication=false

DLQ_ARN=$(awslocal sqs get-queue-attributes \
    --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

# Create Main FIFO Queue with RedrivePolicy pointing to DLQ
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"

awslocal sqs create-queue \
    --queue-name wager-transactions.fifo \
    --attributes FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy="${REDRIVE_POLICY}"

echo "SQS queues initialized successfully:"
awslocal sqs list-queues
