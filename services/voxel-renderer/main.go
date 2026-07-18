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
	"math"
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

type appearance struct{ base, accent color.RGBA }

func material(id string) appearance {
	known := map[string]appearance{
		"minecraft:stone":         {color.RGBA{125, 125, 121, 255}, color.RGBA{86, 87, 84, 255}},
		"minecraft:cobblestone":   {color.RGBA{119, 119, 115, 255}, color.RGBA{75, 76, 73, 255}},
		"minecraft:deepslate":     {color.RGBA{75, 77, 80, 255}, color.RGBA{48, 50, 54, 255}},
		"minecraft:dirt":          {color.RGBA{118, 84, 58, 255}, color.RGBA{80, 56, 36, 255}},
		"minecraft:grass_block":   {color.RGBA{99, 139, 60, 255}, color.RGBA{63, 97, 40, 255}},
		"minecraft:sand":          {color.RGBA{216, 201, 140, 255}, color.RGBA{182, 166, 110, 255}},
		"minecraft:bricks":        {color.RGBA{152, 86, 70, 255}, color.RGBA{99, 55, 47, 255}},
		"minecraft:glass":         {color.RGBA{168, 213, 220, 210}, color.RGBA{230, 251, 255, 210}},
		"minecraft:water":         {color.RGBA{47, 111, 209, 220}, color.RGBA{117, 185, 237, 220}},
		"minecraft:gold_block":    {color.RGBA{231, 189, 53, 255}, color.RGBA{255, 225, 112, 255}},
		"minecraft:iron_block":    {color.RGBA{200, 201, 196, 255}, color.RGBA{242, 242, 233, 255}},
		"minecraft:diamond_block": {color.RGBA{69, 199, 189, 255}, color.RGBA{155, 244, 232, 255}},
		"intelacraft:missing":     {color.RGBA{255, 212, 59, 255}, color.RGBA{255, 240, 166, 255}},
		"intelacraft:incorrect":   {color.RGBA{255, 82, 82, 255}, color.RGBA{255, 176, 169, 255}},
		"intelacraft:unexpected":  {color.RGBA{178, 107, 255, 255}, color.RGBA{222, 194, 255, 255}},
	}
	if a, ok := known[id]; ok {
		return a
	}
	switch {
	case strings.Contains(id, "glass") || strings.Contains(id, "ice"):
		return appearance{color.RGBA{156, 200, 210, 210}, color.RGBA{227, 245, 246, 210}}
	case strings.Contains(id, "leaves") || strings.Contains(id, "moss") || strings.Contains(id, "vine"):
		return appearance{color.RGBA{71, 123, 58, 255}, color.RGBA{121, 166, 78, 255}}
	case strings.Contains(id, "log") || strings.Contains(id, "wood") || strings.Contains(id, "planks") || strings.Contains(id, "bamboo"):
		return appearance{color.RGBA{154, 112, 69, 255}, color.RGBA{96, 69, 45, 255}}
	case strings.Contains(id, "brick") || strings.Contains(id, "terracotta"):
		return appearance{color.RGBA{150, 89, 71, 255}, color.RGBA{101, 59, 49, 255}}
	case strings.Contains(id, "sand") || strings.Contains(id, "end_stone"):
		return appearance{color.RGBA{210, 193, 139, 255}, color.RGBA{170, 152, 103, 255}}
	case strings.Contains(id, "grass") || strings.Contains(id, "dirt") || strings.Contains(id, "mud"):
		return appearance{color.RGBA{117, 87, 61, 255}, color.RGBA{78, 56, 39, 255}}
	case strings.Contains(id, "ore") || strings.Contains(id, "iron") || strings.Contains(id, "gold") || strings.Contains(id, "copper") || strings.Contains(id, "diamond") || strings.Contains(id, "emerald"):
		return appearance{color.RGBA{143, 150, 151, 255}, color.RGBA{201, 208, 207, 255}}
	case strings.Contains(id, "light") || strings.Contains(id, "torch") || strings.Contains(id, "lantern") || strings.Contains(id, "magma"):
		return appearance{color.RGBA{214, 155, 67, 255}, color.RGBA{255, 223, 123, 255}}
	case strings.Contains(id, "stone") || strings.Contains(id, "slate") || strings.Contains(id, "tuff") || strings.Contains(id, "basalt") || strings.Contains(id, "concrete"):
		return appearance{color.RGBA{119, 123, 121, 255}, color.RGBA{81, 85, 83, 255}}
	default:
		return appearance{color.RGBA{139, 129, 115, 255}, color.RGBA{93, 87, 78, 255}}
	}
}
func tint(c color.RGBA, factor float64) color.RGBA {
	clamp := func(v float64) uint8 { return uint8(math.Min(255, math.Max(0, v))) }
	return color.RGBA{clamp(float64(c.R) * factor), clamp(float64(c.G) * factor), clamp(float64(c.B) * factor), c.A}
}

type point struct{ x, y int }

func fillPolygon(img *image.RGBA, points []point, c color.RGBA) {
	minY, maxY := points[0].y, points[0].y
	for _, p := range points[1:] {
		if p.y < minY {
			minY = p.y
		}
		if p.y > maxY {
			maxY = p.y
		}
	}
	for y := minY; y <= maxY; y++ {
		xs := []int{}
		for i, a := range points {
			b := points[(i+1)%len(points)]
			if a.y == b.y || y < min(a.y, b.y) || y >= max(a.y, b.y) {
				continue
			}
			xs = append(xs, a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y))
		}
		sort.Ints(xs)
		for i := 0; i+1 < len(xs); i += 2 {
			for x := xs[i]; x <= xs[i+1]; x++ {
				if image.Pt(x, y).In(img.Bounds()) {
					img.SetRGBA(x, y, c)
				}
			}
		}
	}
}
func line(img *image.RGBA, a, b point, c color.RGBA) {
	dx, dy := abs(b.x-a.x), -abs(b.y-a.y)
	sx, sy := -1, -1
	if a.x < b.x {
		sx = 1
	}
	if a.y < b.y {
		sy = 1
	}
	err := dx + dy
	for {
		if image.Pt(a.x, a.y).In(img.Bounds()) {
			img.SetRGBA(a.x, a.y, c)
		}
		if a == b {
			break
		}
		e := 2 * err
		if e >= dy {
			err += dy
			a.x += sx
		}
		if e <= dx {
			err += dx
			a.y += sy
		}
	}
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}
func drawCube(img *image.RGBA, cx, cy, s int, a appearance) {
	h := max(2, s/2)
	top := []point{{cx, cy - h}, {cx + s, cy}, {cx, cy + h}, {cx - s, cy}}
	left := []point{{cx - s, cy}, {cx, cy + h}, {cx, cy + h + s}, {cx - s, cy + s}}
	right := []point{{cx + s, cy}, {cx, cy + h}, {cx, cy + h + s}, {cx + s, cy + s}}
	fillPolygon(img, left, tint(a.base, .72))
	fillPolygon(img, right, tint(a.base, .88))
	fillPolygon(img, top, tint(a.base, 1.12))
	edge := tint(a.accent, .62)
	for _, face := range [][]point{left, right, top} {
		for i, p := range face {
			line(img, p, face[(i+1)%len(face)], edge)
		}
	}
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
	blocks := make([]Block, 0, len(p.State.Blocks))
	for _, b := range p.State.Blocks {
		if b.BlockType != "minecraft:air" {
			blocks = append(blocks, b)
		}
	}
	sort.Slice(blocks, func(i, j int) bool { a, b := blocks[i].Position, blocks[j].Position; return a.X+a.Z+a.Y < b.X+b.Z+b.Y })
	if len(blocks) == 0 {
		blocks = []Block{}
	}
	minPX, maxPX, minPY, maxPY := 0, 0, 0, 0
	if len(blocks) > 0 {
		minPX, maxPX = blocks[0].Position.X-blocks[0].Position.Z, blocks[0].Position.X-blocks[0].Position.Z
		minPY, maxPY = blocks[0].Position.X+blocks[0].Position.Z-2*blocks[0].Position.Y, blocks[0].Position.X+blocks[0].Position.Z-2*blocks[0].Position.Y
	}
	for _, b := range blocks {
		x := b.Position.X - b.Position.Z
		y := b.Position.X + b.Position.Z - 2*b.Position.Y
		if x < minPX {
			minPX = x
		}
		if x > maxPX {
			maxPX = x
		}
		if y < minPY {
			minPY = y
		}
		if y > maxPY {
			maxPY = y
		}
	}
	spanX, spanY := maxPX-minPX+2, maxPY-minPY+3
	margin := max(8, min(p.Width, p.Height)/14)
	scale := max(2, min((p.Width-2*margin)/max(1, 2*spanX), (p.Height-2*margin)/max(1, spanY)))
	centerPX, centerPY := (minPX+maxPX)/2, (minPY+maxPY)/2
	for _, b := range blocks {
		x := p.Width/2 + (b.Position.X-b.Position.Z-centerPX)*scale*2
		y := p.Height/2 + (b.Position.X+b.Position.Z-2*b.Position.Y-centerPY)*scale/2 - scale/2
		drawCube(img, x, y, scale, material(b.BlockType))
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
