# Color Picker Tool

Công cụ chọn và chuyển đổi màu với hỗ trợ nhiều định dạng và Pantone colors.

## Tính năng

### 🎨 Chọn màu trực quan
- Color picker HTML5 native
- Preview box lớn (128x128px)
- Real-time update
- Input HEX trực tiếp

### 📊 Định dạng màu được hỗ trợ

#### 1. HEX
- Format: `#RRGGBB`
- Editable input
- Copy to clipboard
- Auto uppercase

#### 2. RGB (Red, Green, Blue)
- 3 inputs riêng biệt (0-255)
- Real-time conversion
- Copy format: `rgb(r, g, b)`
- Editable và interactive

#### 3. CMYK (Cyan, Magenta, Yellow, Black)
- Display only (read-only)
- 4 values trong phần trăm
- Copy format: `cmyk(c%, m%, y%, k%)`
- Chính xác cho in ấn

#### 4. HSL (Hue, Saturation, Lightness)
- Display only (read-only)
- Hue: 0-360°
- Saturation: 0-100%
- Lightness: 0-100%
- Copy format: `hsl(h, s%, l%)`

### 🎨 Pantone Colors

#### Search & Select
- 12 Pantone colors phổ biến
- Tìm kiếm theo code hoặc tên
- Click để chọn màu
- Hiển thị hex code

#### Danh sách Pantone
```
PANTONE 186 C   - Red      #C8102E
PANTONE 293 C   - Blue     #003087
PANTONE 348 C   - Green    #00843D
PANTONE 116 C   - Yellow   #FFCD00
PANTONE 151 C   - Orange   #FF6900
PANTONE 2592 C  - Purple   #A82F8D
PANTONE 485 C   - Red      #DA291C
PANTONE 286 C   - Blue     #0033A0
PANTONE 355 C   - Green    #009639
PANTONE 109 C   - Yellow   #FFD700
PANTONE Black C - Black    #000000
PANTONE Cool Gray 11 C     #53565A
```

## Chuyển đổi màu

### HEX → RGB
```typescript
hexToRgb("#3B82F6")
// Output: { r: 59, g: 130, b: 246 }
```

### RGB → CMYK
```typescript
rgbToCmyk(59, 130, 246)
// Output: { c: 76, m: 47, y: 0, k: 4 }
```

### RGB → HSL
```typescript
rgbToHsl(59, 130, 246)
// Output: { h: 217, s: 91, l: 60 }
```

## Giao diện

### Layout Structure
```
┌─────────────────────────────────────────┐
│ Color Preview                           │
│ ┌──────┐  ┌──────────────────┐         │
│ │      │  │ [picker] [#hex]  │         │
│ │ 128  │  │                   │         │
│ │ x128 │  └──────────────────┘         │
│ └──────┘                                │
├─────────────────────────────────────────┤
│ HEX:  [#3B82F6]              [Copy]    │
│ RGB:  [59] [130] [246]       [Copy]    │
│ CMYK: [76%] [47%] [0%] [4%]  [Copy]    │
│ HSL:  [217°] [91%] [60%]     [Copy]    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Pantone Colors                          │
│ [Search: ___________]                   │
├─────────────────────────────────────────┤
│ ┌──┐ PANTONE 186 C    ┌──┐ PANTONE... │
│ │▓▓│ #C8102E          │▓▓│ ...         │
│ └──┘                  └──┘             │
└─────────────────────────────────────────┘
```

## Use Cases

### Thiết kế Web/App
- Chọn màu theme
- Copy hex cho CSS
- Convert RGB cho canvas
- HSL cho animations

### In ấn
- CMYK values chính xác
- Pantone color matching
- Brand color consistency

### Branding
- Pantone reference
- Color palette planning
- Brand guidelines

### Development
- CSS color values
- Design system colors
- Component theming

## Copy Buttons

Mỗi định dạng có button copy riêng:
- HEX: `#3B82F6`
- RGB: `rgb(59, 130, 246)`
- CMYK: `cmyk(76%, 47%, 0%, 4%)`
- HSL: `hsl(217, 91%, 60%)`

## Interactive Features

### Editable Inputs
- HEX input: Type or paste hex values
- RGB inputs: Number inputs with min/max
- Auto-sync tất cả formats

### Real-time Updates
- Mỗi thay đổi update ngay lập tức
- Không cần button "Convert"
- Smooth transitions

### Validation
- HEX: Validates format `#RRGGBB`
- RGB: Clamps to 0-255 range
- Auto-correct invalid values

## Keyboard Support

- Tab navigation giữa inputs
- Enter để copy (khi focus vào input)
- Number inputs hỗ trợ arrow keys
- Search box có focus khi mở Pantone

## Responsive Design

### Desktop
- Full 3-column grid cho Pantone
- Side-by-side color preview
- Comfortable spacing

### Mobile
- 2-column grid cho Pantone
- Stacked preview layout
- Touch-friendly buttons

## Technical Details

### Color Conversion Algorithms

**RGB to CMYK:**
```
K = 1 - max(R', G', B')
C = (1 - R' - K) / (1 - K)
M = (1 - G' - K) / (1 - K)
Y = (1 - B' - K) / (1 - K)
```

**RGB to HSL:**
```
Max = max(R', G', B')
Min = min(R', G', B')
L = (Max + Min) / 2

if Max ≠ Min:
  S = (Max - Min) / (2 - Max - Min) if L > 0.5
  H = calculated based on which of R, G, B is max
```

### Performance
- `useMemo` cho color conversions
- Debounced updates cho typing
- Efficient re-renders

## Future Enhancements

Có thể thêm:
- [ ] Color palette generator
- [ ] Complementary colors
- [ ] Color harmony (triadic, analogous)
- [ ] Gradient generator
- [ ] Color blindness simulator
- [ ] More Pantone colors (full library)
- [ ] RAL color system
- [ ] Color history/favorites
- [ ] Export palette as JSON/CSS
- [ ] Upload image to extract colors

## Browser Support

- ✅ Chrome/Edge: Full support
- ✅ Firefox: Full support
- ✅ Safari: Full support
- ✅ Mobile browsers: Native color picker

## Accessibility

- Keyboard navigable
- Screen reader friendly
- High contrast mode compatible
- Focus indicators
- Clear labels
