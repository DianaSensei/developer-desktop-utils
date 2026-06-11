# Layout Design - DevUtils Style

Ứng dụng được thiết kế theo nguyên tắc: **Đơn giản, Gọn gàng, Tập trung vào chức năng**

## Nguyên tắc thiết kế

### 1. Không gian tối ưu cho công cụ
- Phần lớn màn hình (85-90%) dành cho nội dung công cụ
- Sidebar chỉ chiếm 15-20% (hoặc thu gọn về 64px)
- Không có max-width constraint - sử dụng toàn bộ không gian có sẵn

### 2. Sidebar tối giản
- **Expanded**: 256px - vừa đủ hiển thị tên công cụ
- **Collapsed**: 64px - chỉ hiển thị icon
- Không có thông tin thừa
- Navigation đơn giản, rõ ràng

### 3. Kích thước linh hoạt
- Hoạt động tốt ở kích thước nhỏ (800x600)
- Mở rộng tốt ở màn hình lớn
- Responsive cho mobile

### 4. Tập trung vào chức năng
- Không có banner, hero section
- Không có marketing content
- Không có decoration không cần thiết
- Chỉ công cụ và chức năng

## Cấu trúc Layout

```
┌─────────────┬──────────────────────────────────┐
│             │                                  │
│   Sidebar   │        Tool Content Area        │
│   (256px)   │         (Full Width)            │
│             │                                  │
│   - Tools   │    Input/Output                 │
│   - List    │    Forms                        │
│             │    Results                      │
│             │                                  │
│             │    Maximum space for            │
│   [Toggle]  │    working with the tool        │
│             │                                  │
└─────────────┴──────────────────────────────────┘
```

## Cải tiến đã thực hiện

### Sidebar
- ✅ Giảm padding: `py-4 px-4` → `py-2 px-1`
- ✅ Giảm kích thước font: Smaller icons, compact spacing
- ✅ Giảm gap giữa items: `space-y-1` → `space-y-0.5`
- ✅ Header nhỏ gọn hơn: `text-2xl` → `text-xl`
- ✅ Buttons nhỏ hơn: `h-10 w-10` → `h-8 w-8`

### Content Area
- ✅ Loại bỏ `max-w-6xl` - sử dụng full width
- ✅ Giảm padding: `p-6` → `p-4 md:p-6`
- ✅ Tối ưu cho không gian làm việc
- ✅ Background color để phân biệt vùng làm việc

### Cards (Tool Components)
- Current: Still using Card components with headers
- Recommendation: Có thể bỏ Card và dùng layout trực tiếp

## Tối ưu thêm (Tuỳ chọn)

### Loại bỏ Card wrapper
Thay vì:
```tsx
<Card>
  <CardHeader>
    <CardTitle>Tool Name</CardTitle>
  </CardHeader>
  <CardContent>
    {/* content */}
  </CardContent>
</Card>
```

Dùng:
```tsx
<div className="space-y-6">
  <h2 className="text-lg font-semibold">Tool Name</h2>
  <div className="space-y-4">
    {/* content */}
  </div>
</div>
```

### Giảm spacing
```tsx
// Thay đổi trong tool components
space-y-4 → space-y-3
p-6 → p-4
gap-4 → gap-3
```

### Input/Output tối ưu
```tsx
// Compact input với actions inline
<div className="flex gap-2">
  <Input className="flex-1" />
  <Button size="sm">Action</Button>
  <Button size="sm" variant="ghost">
    <Copy className="h-4 w-4" />
  </Button>
</div>
```

## So sánh trước/sau

### Trước
- Sidebar: 256px với nhiều padding
- Content: max-width 1280px với padding lớn
- Cards: Nhiều spacing, border nổi bật
- Overall: ~70% không gian cho tool

### Sau
- Sidebar: 256px/64px với padding tối thiểu
- Content: Full width với padding vừa phải
- Cards: Gọn gàng, focus vào nội dung
- Overall: ~85-90% không gian cho tool

## Keyboard & Usability

- ✅ Tab navigation hoạt động tốt
- ✅ Keyboard shortcuts có thể thêm
- ✅ Focus states rõ ràng
- ✅ Copy buttons ở vị trí dễ tiếp cận

## Dark Mode

- ✅ Tối ưu cho làm việc lâu dài
- ✅ Contrast tốt
- ✅ Không mỏi mắt
- ✅ Toggle dễ dàng

## Performance

- Fast rendering (chỉ re-render tool đang active)
- Minimal animations (300ms collapse/expand)
- No unnecessary computations
- LocalStorage cho settings

## Responsive

### Desktop (>1024px)
- Sidebar visible
- Full tool space
- Collapsible sidebar

### Tablet (768-1024px)
- Sidebar overlay
- Full width content
- Touch-friendly

### Mobile (<768px)
- Hamburger menu
- Full screen tool
- Optimized for portrait

## Tương lai

Có thể cải thiện thêm:
- [ ] Command palette (Cmd+K) để tìm tool nhanh
- [ ] Keyboard shortcuts cho từng tool
- [ ] Quick switcher (Cmd+J) giữa các tools
- [ ] Split view cho 2 tools cùng lúc
- [ ] Customizable layout (drag-drop)
- [ ] Workspace presets
