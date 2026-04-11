package sshtransport

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"golang.org/x/crypto/ssh"
)

func Connect(target contracts.TerminalEndpoint, bastion *contracts.TerminalEndpoint) (*ssh.Client, func(), error) {
	targetConfig, err := clientConfig(target)
	if err != nil {
		return nil, nil, err
	}

	targetAddr := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	if bastion == nil {
		client, err := ssh.Dial("tcp", targetAddr, targetConfig)
		if err != nil {
			return nil, nil, err
		}
		return client, func() { _ = client.Close() }, nil
	}

	bastionConfig, err := clientConfig(*bastion)
	if err != nil {
		return nil, nil, err
	}
	bastionAddr := net.JoinHostPort(bastion.Host, strconv.Itoa(bastion.Port))

	bastionClient, err := ssh.Dial("tcp", bastionAddr, bastionConfig)
	if err != nil {
		return nil, nil, err
	}

	tunnelConn, err := bastionClient.Dial("tcp", targetAddr)
	if err != nil {
		_ = bastionClient.Close()
		return nil, nil, err
	}

	conn, chans, reqs, err := ssh.NewClientConn(tunnelConn, targetAddr, targetConfig)
	if err != nil {
		_ = tunnelConn.Close()
		_ = bastionClient.Close()
		return nil, nil, err
	}

	client := ssh.NewClient(conn, chans, reqs)
	return client, func() {
		_ = client.Close()
		_ = bastionClient.Close()
	}, nil
}

func clientConfig(endpoint contracts.TerminalEndpoint) (*ssh.ClientConfig, error) {
	authMethods := make([]ssh.AuthMethod, 0, 2)
	if strings.TrimSpace(endpoint.Password) != "" {
		authMethods = append(authMethods, ssh.Password(endpoint.Password))
	}
	if strings.TrimSpace(endpoint.PrivateKey) != "" {
		var (
			signer ssh.Signer
			err    error
		)
		if strings.TrimSpace(endpoint.Passphrase) != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(endpoint.PrivateKey), []byte(endpoint.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(endpoint.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key for %s@%s: %w", endpoint.Username, endpoint.Host, err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}
	if len(authMethods) == 0 {
		return nil, errors.New("ssh credentials are required")
	}

	return &ssh.ClientConfig{
		User:            endpoint.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}, nil
}

func MapConnectionError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "unable to authenticate"), strings.Contains(message, "permission denied"):
		return "authentication failed"
	case strings.Contains(message, "no such host"),
		strings.Contains(message, "name or service not known"),
		strings.Contains(message, "temporary failure in name resolution"),
		strings.Contains(message, "unknown host"):
		return "terminal target DNS lookup failed"
	case strings.Contains(message, "connection refused"):
		return "terminal target refused the connection"
	case strings.Contains(message, "no route to host"), strings.Contains(message, "network is unreachable"):
		return "terminal target is unreachable"
	case strings.Contains(message, "i/o timeout"), strings.Contains(message, "deadline exceeded"):
		return "terminal target timed out"
	default:
		return "terminal connection failed"
	}
}
