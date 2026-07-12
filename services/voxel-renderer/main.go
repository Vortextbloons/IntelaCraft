package main

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const version = 1
const maxBlocks = 32768

type Vec3 struct {
	X int `json:"x"`
	Y int `json:"y"`
	Z int `json:"z"`
}
type Block struct {
	Position  Vec3   `json:"position"`
	BlockType string `json:"blockType"`
}
type State struct {
	Version int     `json:"version"`
	Blocks  []Block `json:"blocks"`
}
type Request struct {
	ID      string          `json:"id"`
	Command string          `json:"command"`
	Payload json.RawMessage `json:"payload"`
}
type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  *Err   `json:"error,omitempty"`
}
type Err struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type renderPayload struct {
	State      State  `json:"state"`
	OutputPath string `json:"outputPath"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
}

func fail(id, code, message string) Response {
	return Response{ID: id, OK: false, Error: &Err{code, message}}
}
func valid(s State) error {
	if s.Version != 1 {
		return fmt.Errorf("state version must be 1")
	}
	if len(s.Blocks) > maxBlocks {
		return fmt.Errorf("block count exceeds %d", maxBlocks)
	}
	seen := map[Vec3]bool{}
	for _, b := range s.Blocks {
		if b.BlockType == "" {
			return fmt.Errorf("blockType is required")
		}
		if seen[b.Position] {
			return fmt.Errorf("duplicate block position")
		}
		seen[b.Position] = true
	}
	return nil
}
func scene(s State) map[string]any {
	occupied := map[Vec3]Block{}
	for _, b := range s.Blocks {
		if b.BlockType != "minecraft:air" {
			occupied[b.Position] = b
		}
	}
	dirs := []Vec3{{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}}
	type face struct {
		Position  Vec3   `json:"position"`
		BlockType string `json:"blockType"`
		Sides     []int  `json:"sides"`
	}
	faces := []face{}
	keys := make([]Vec3, 0, len(occupied))
	for p := range occupied {
		keys = append(keys, p)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if a.Y != b.Y {
			return a.Y < b.Y
		}
		if a.X != b.X {
			return a.X < b.X
		}
		return a.Z < b.Z
	})
	for _, p := range keys {
		sides := []int{}
		for i, d := range dirs {
			if _, ok := occupied[Vec3{p.X + d.X, p.Y + d.Y, p.Z + d.Z}]; !ok {
				sides = append(sides, i)
			}
		}
		if len(sides) > 0 {
			faces = append(faces, face{p, occupied[p].BlockType, sides})
		}
	}
	return map[string]any{"version": 1, "blocks": len(occupied), "visibleBlocks": faces}
}
func shade(id string) color.RGBA {
	var h uint32 = 2166136261
	for _, r := range id {
		h ^= uint32(r)
		h *= 16777619
	}
	return color.RGBA{uint8(55 + h%170), uint8(55 + (h>>8)%170), uint8(55 + (h>>16)%170), 255}
}
func pngChunk(w *os.File, kind string, data []byte) error {
	if err := binary.Write(w, binary.BigEndian, uint32(len(data))); err != nil {
		return err
	}
	chunk := append([]byte(kind), data...)
	if _, err := w.Write(chunk); err != nil {
		return err
	}
	return binary.Write(w, binary.BigEndian, crc32.ChecksumIEEE(chunk))
}
func encodePNG(w *os.File, img *image.RGBA) error {
	if _, err := w.Write([]byte{137, 80, 78, 71, 13, 10, 26, 10}); err != nil {
		return err
	}
	header := make([]byte, 13)
	binary.BigEndian.PutUint32(header[0:4], uint32(img.Bounds().Dx()))
	binary.BigEndian.PutUint32(header[4:8], uint32(img.Bounds().Dy()))
	header[8] = 8
	header[9] = 6
	if err := pngChunk(w, "IHDR", header); err != nil {
		return err
	}
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	for y := 0; y < img.Bounds().Dy(); y++ {
		zw.Write([]byte{0})
		start := y * img.Stride
		zw.Write(img.Pix[start : start+img.Bounds().Dx()*4])
	}
	if err := zw.Close(); err != nil {
		return err
	}
	if err := pngChunk(w, "IDAT", compressed.Bytes()); err != nil {
		return err
	}
	return pngChunk(w, "IEND", nil)
}
func render(p renderPayload) error {
	if err := valid(p.State); err != nil {
		return err
	}
	if p.Width <= 0 {
		p.Width = 640
	}
	if p.Height <= 0 {
		p.Height = 480
	}
	if p.Width > 2048 || p.Height > 2048 {
		return fmt.Errorf("image dimensions exceed 2048")
	}
	if p.OutputPath == "" || strings.ToLower(filepath.Ext(p.OutputPath)) != ".png" {
		return fmt.Errorf("outputPath must end in .png")
	}
	img := image.NewRGBA(image.Rect(0, 0, p.Width, p.Height))
	for y := 0; y < p.Height; y++ {
		for x := 0; x < p.Width; x++ {
			img.Set(x, y, color.RGBA{24, 28, 35, 255})
		}
	}
	blocks := append([]Block(nil), p.State.Blocks...)
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].Position.Y < blocks[j].Position.Y })
	scale := 8
	for _, b := range blocks {
		if b.BlockType == "minecraft:air" {
			continue
		}
		x := p.Width/2 + (b.Position.X-b.Position.Z)*scale
		y := p.Height/2 + (b.Position.X+b.Position.Z)*scale/2 - b.Position.Y*scale
		c := shade(b.BlockType)
		for dy := 0; dy < scale; dy++ {
			for dx := 0; dx < scale; dx++ {
				px, py := x+dx-scale/2, y+dy-scale/2
				if px >= 0 && py >= 0 && px < p.Width && py < p.Height {
					img.Set(px, py, c)
				}
			}
		}
	}
	if err := os.MkdirAll(filepath.Dir(p.OutputPath), 0755); err != nil {
		return err
	}
	f, err := os.Create(p.OutputPath)
	if err != nil {
		return err
	}
	defer f.Close()
	return encodePNG(f, img)
}
func handle(r Request) Response {
	switch r.Command {
	case "health":
		return Response{ID: r.ID, OK: true, Result: map[string]any{"version": version, "status": "ok"}}
	case "process_scene":
		var s State
		if json.Unmarshal(r.Payload, &s) != nil {
			return fail(r.ID, "INVALID_PAYLOAD", "invalid state")
		}
		if err := valid(s); err != nil {
			return fail(r.ID, "INVALID_STATE", err.Error())
		}
		return Response{ID: r.ID, OK: true, Result: scene(s)}
	case "render_image", "generate_thumbnail":
		var p renderPayload
		if json.Unmarshal(r.Payload, &p) != nil {
			return fail(r.ID, "INVALID_PAYLOAD", "invalid render payload")
		}
		if r.Command == "generate_thumbnail" {
			if p.Width == 0 {
				p.Width = 320
			}
			if p.Height == 0 {
				p.Height = 240
			}
		}
		if err := render(p); err != nil {
			return fail(r.ID, "RENDER_FAILED", err.Error())
		}
		return Response{ID: r.ID, OK: true, Result: map[string]any{"outputPath": p.OutputPath, "format": "png"}}
	case "compare_snapshots":
		var p struct {
			Expected State `json:"expected"`
			Actual   State `json:"actual"`
		}
		if json.Unmarshal(r.Payload, &p) != nil {
			return fail(r.ID, "INVALID_PAYLOAD", "invalid comparison payload")
		}
		if err := valid(p.Expected); err != nil {
			return fail(r.ID, "INVALID_STATE", err.Error())
		}
		if err := valid(p.Actual); err != nil {
			return fail(r.ID, "INVALID_STATE", err.Error())
		}
		a := map[Vec3]string{}
		for _, b := range p.Actual.Blocks {
			a[b.Position] = b.BlockType
		}
		correct := 0
		for _, b := range p.Expected.Blocks {
			if a[b.Position] == b.BlockType {
				correct++
			}
		}
		return Response{ID: r.ID, OK: true, Result: map[string]any{"expected": len(p.Expected.Blocks), "correct": correct}}
	default:
		return fail(r.ID, "UNKNOWN_COMMAND", "unsupported command")
	}
}
func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	enc := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var r Request
		if err := json.Unmarshal(scanner.Bytes(), &r); err != nil {
			enc.Encode(fail("", "INVALID_JSON", err.Error()))
			continue
		}
		enc.Encode(handle(r))
	}
}
