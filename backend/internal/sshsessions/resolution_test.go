package sshsessions

import "testing"

func TestSnapshotConnectionRecordClonesTransferRetentionPolicy(t *testing.T) {
	record := connectionRecord{
		ID:                      "conn-1",
		Type:                    "SSH",
		Host:                    "ssh.example.com",
		Port:                    22,
		DLPPolicy:               []byte(`{"disableCopy":true}`),
		TransferRetentionPolicy: []byte(`{"retainSuccessfulUploads":true}`),
	}

	snapshot := snapshotConnectionRecord(record)
	if string(snapshot.TransferRetentionPolicy) != `{"retainSuccessfulUploads":true}` {
		t.Fatalf("unexpected transfer retention policy: %s", string(snapshot.TransferRetentionPolicy))
	}
	if string(snapshot.DLPPolicy) != `{"disableCopy":true}` {
		t.Fatalf("unexpected dlp policy: %s", string(snapshot.DLPPolicy))
	}

	record.TransferRetentionPolicy[0] = '['
	record.DLPPolicy[0] = '['
	if string(snapshot.TransferRetentionPolicy) != `{"retainSuccessfulUploads":true}` {
		t.Fatal("expected snapshot transfer retention policy to be cloned")
	}
	if string(snapshot.DLPPolicy) != `{"disableCopy":true}` {
		t.Fatal("expected snapshot dlp policy to be cloned")
	}
}
