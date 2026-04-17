package main
import (
  "context"
  "fmt"
  "os"
  desktopbroker "github.com/dnviti/arsenale/backend/internal/desktopbroker"
  "github.com/dnviti/arsenale/backend/internal/storage"
)
func main() {
  if len(os.Args) != 3 { panic("usage: storeprobe <token-file> <connection-id>") }
  tokenBytes, err := os.ReadFile(os.Args[1]); if err != nil { panic(err) }
  tokenHash := desktopbroker.HashToken(string(tokenBytes))
  db, err := storage.OpenPostgres(context.Background()); if err != nil { panic(err) }
  defer db.Close()
  store := desktopbroker.NewPostgresSessionStore(db)
  if err := store.RecordDesktopConnectionReady(context.Background(), tokenHash, os.Args[2]); err != nil {
    fmt.Printf("ERROR=%v\n", err)
    return
  }
  fmt.Println("OK")
}
