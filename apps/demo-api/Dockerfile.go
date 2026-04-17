//go:build ignore
// +build ignore
FROM golang:1.22 AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 go build -o /app/bin/demo-api ./cmd/demo-api

FROM gcr.io/distroless/base-debian12

WORKDIR /app

COPY --from=builder /app/bin/demo-api /app/demo-api

EXPOSE 8000

CMD ["/app/demo-api"]
