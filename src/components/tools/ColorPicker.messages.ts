import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  clickToSelect: { vi: '{{hex}} — bấm để chọn', en: '{{hex}} — click to select' },
  clickToCopy: { vi: 'Bấm để sao chép {{value}}', en: 'Click to copy {{value}}' },
  image: { vi: 'Ảnh', en: 'Image' },
  imageHelp: { vi: 'Rê chuột trên ảnh để phóng to, rồi bấm để lấy màu dưới tâm ngắm.', en: 'Move over the image to magnify it, then click to pick the color under the crosshair.' },
  colors: { vi: 'Màu', en: 'Colors' },
  colorsHelp: {
    vi: '"Đã chọn" là màu bạn lấy gần nhất (bấm thanh trượt để chỉnh). "Đang rê" theo con trỏ trên ảnh. Bấm vào giá trị bất kỳ để sao chép.',
    en: 'Selected is your last pick (click the sliders to fine-tune it). Hovering tracks the cursor over the image. Click any value to copy it.',
  },
  selected: { vi: 'Đã chọn', en: 'Selected' },
  adjustSelected: { vi: 'Chỉnh màu đã chọn', en: 'Adjust the selected color' },
  hovering: { vi: 'Đang rê', en: 'Hovering' },
  selectedColor: { vi: 'Đã chọn {{color}}', en: 'Selected {{color}}' },
  hoveringColor: { vi: 'Đang rê {{color}}', en: 'Hovering {{color}}' },
  moveOverImage: { vi: 'Rê chuột trên ảnh', en: 'Move over the image' },
  palette: { vi: 'Bảng màu', en: 'Color Palette' },
  paletteHelp: {
    vi: 'Các màu trích từ ảnh. Bấm một ô màu để chọn. Khi không vừa, dải màu cuộn ngang.',
    en: 'Colors extracted from the image. Click a swatch to select it. When there are more than fit, the strip scrolls sideways.',
  },
  scroll: { vi: 'cuộn', en: 'scroll' },
  downloadPalette: { vi: 'Tải bảng màu dạng PNG', en: 'Download palette as PNG' },
  copyHexes: { vi: 'Sao chép mọi mã hex', en: 'Copy all hex codes' },
  noColors: { vi: 'Chưa có màu', en: 'No colors' },
  ownImage: { vi: 'Dùng ảnh của bạn', en: 'Use your own image' },
  useImage: { vi: 'Chọn ảnh', en: 'Use your image' },
  pickFromScreen: { vi: 'Lấy màu trên màn hình', en: 'Pick from Screen' },
});
