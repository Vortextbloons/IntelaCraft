package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSceneAndRender(t *testing.T) {
	s := State{Version: 1, Blocks: []Block{{Vec3{0, 0, 0}, "minecraft:stone"}, {Vec3{1, 0, 0}, "minecraft:stone"}}}
	raw, _ := json.Marshal(s)
	r := handle(Request{ID: "1", Command: "process_scene", Payload: raw})
	if !r.OK {
		t.Fatal(r.Error)
	}
	path := filepath.Join(t.TempDir(), "view.png")
	payload, _ := json.Marshal(renderPayload{State: s, OutputPath: path, Width: 64, Height: 64})
	r = handle(Request{ID: "2", Command: "render_image", Payload: payload})
	if !r.OK {
		t.Fatal(r.Error)
	}
	if info, err := os.Stat(path); err != nil || info.Size() == 0 {
		t.Fatal("png missing")
	}
}
func TestRejectsOversize(t *testing.T) {
	s := State{Version: 1, Blocks: make([]Block, maxBlocks+1)}
	raw, _ := json.Marshal(s)
	if handle(Request{ID: "x", Command: "process_scene", Payload: raw}).OK {
		t.Fatal("expected rejection")
	}
}
