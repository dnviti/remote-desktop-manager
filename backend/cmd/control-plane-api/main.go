package main

import "context"

func main() {
	ctx := context.Background()

	runtime, err := newAPIRuntime(ctx)
	if err != nil {
		panic(err)
	}
	defer runtime.Close()

	if err := runtime.Run(ctx); err != nil {
		panic(err)
	}
}
