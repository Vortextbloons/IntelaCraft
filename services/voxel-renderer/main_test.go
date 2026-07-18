package main

import (
	"encoding/json"
	"image/png"
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
func TestRenderFitsMixedMaterialsAndUsesRepresentativeColors(t *testing.T) {
	s := State{Version: 1, Blocks: []Block{
		{Vec3{0, 0, 0}, "minecraft:stone"},
		{Vec3{1, 0, 0}, "minecraft:grass_block"},
		{Vec3{0, 1, 0}, "minecraft:gold_block"},
	}}
	path := filepath.Join(t.TempDir(), "mixed.png")
	payload, _ := json.Marshal(renderPayload{State: s, OutputPath: path, Width: 128, Height: 128})
	if r := handle(Request{ID: "mixed", Command: "render_image", Payload: payload}); !r.OK {
		t.Fatal(r.Error)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img, err := png.Decode(file)
	if err != nil {
		t.Fatal(err)
	}
	background := img.At(0, 0)
	minX, minY, maxX, maxY := 128, 128, -1, -1
	colors := map[uint32]bool{}
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			br, bg, bb, ba := background.RGBA()
			if r == br && g == bg && b == bb && a == ba {
				continue
			}
			if x < minX {
				minX = x
			}
			if x > maxX {
				maxX = x
			}
			if y < minY {
				minY = y
			}
			if y > maxY {
				maxY = y
			}
			colors[uint32(r>>8)<<24|uint32(g>>8)<<16|uint32(b>>8)<<8|uint32(a>>8)] = true
		}
	}
	if maxX-minX < 48 || maxY-minY < 48 {
		t.Fatalf("render is not fitted to canvas: occupied bounds %dx%d", maxX-minX, maxY-minY)
	}
	if len(colors) < 8 {
		t.Fatalf("mixed materials lack representative color/face diversity: %d colors", len(colors))
	}
}
func TestRejectsOversize(t *testing.T) {
	s := State{Version: 1, Blocks: make([]Block, maxBlocks+1)}
	raw, _ := json.Marshal(s)
	if handle(Request{ID: "x", Command: "process_scene", Payload: raw}).OK {
		t.Fatal("expected rejection")
	}
}
