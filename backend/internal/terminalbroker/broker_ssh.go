package terminalbroker

import (
	"github.com/dnviti/arsenale/backend/internal/sshtransport"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"golang.org/x/crypto/ssh"
)

func connectSSH(grant contracts.TerminalSessionGrant) (*ssh.Client, func(), error) {
	return sshtransport.Connect(grant.Target, grant.Bastion)
}

func mapConnectionError(err error) string {
	return sshtransport.MapConnectionError(err)
}
