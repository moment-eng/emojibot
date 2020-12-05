# Use latest version of Golang
FROM golang:1.14.1

WORKDIR $GOPATH/github.com/moment-eng/emojibot

COPY . .

RUN go install -v ./...

# Exposed port for development. This needs to be an if-statement.
EXPOSE 8080

EXPOSE 443

ENTRYPOINT $GOPATH/bin/emojibot
