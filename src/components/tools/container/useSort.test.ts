import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSort } from './useSort';

type Row = { name: string; size: number };

const rows: Row[] = [
  { name: 'zebra', size: 3 },
  { name: 'apple', size: 1 },
  { name: 'mango', size: 2 },
];

const getters = {
  name: (r: Row) => r.name,
  size: (r: Row) => r.size,
};

// Bọc trong StrictMode để bắt đúng lỗi đã xảy ra thật: React cố ý gọi hàm cập
// nhật state HAI LẦN ở dev để phát hiện side effect bên trong nó. Bản cũ của
// useSort gọi `setSortDir` như side effect bên trong hàm cập nhật của
// `setSortKey` — dưới StrictMode, lời gọi đó chạy hai lần, tự đảo hướng hai
// lần rồi triệt tiêu nhau, nên cột đã sort không bao giờ chuyển sang giảm
// dần được. Không bọc StrictMode thì test này xanh ngay cả với code cũ.
const strict = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.StrictMode, null, children);

describe('useSort', () => {
  it('bấm lần đầu vào một cột mới sort tăng dần', () => {
    const { result } = renderHook(() => useSort(rows, getters), { wrapper: strict });
    act(() => result.current.toggleSort('name'));
    expect(result.current.directionFor('name')).toBe('asc');
    expect(result.current.sorted.map((r) => r.name)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('bấm lần hai vào CÙNG cột đảo sang giảm dần — ca lỗi thật dưới StrictMode', () => {
    const { result } = renderHook(() => useSort(rows, getters), { wrapper: strict });
    act(() => result.current.toggleSort('name'));
    act(() => result.current.toggleSort('name'));
    expect(result.current.directionFor('name')).toBe('desc');
    expect(result.current.sorted.map((r) => r.name)).toEqual(['zebra', 'mango', 'apple']);
  });

  it('bấm lần ba quay lại tăng dần', () => {
    const { result } = renderHook(() => useSort(rows, getters), { wrapper: strict });
    act(() => result.current.toggleSort('name'));
    act(() => result.current.toggleSort('name'));
    act(() => result.current.toggleSort('name'));
    expect(result.current.directionFor('name')).toBe('asc');
  });

  it('chuyển sang cột KHÁC luôn bắt đầu lại từ tăng dần', () => {
    const { result } = renderHook(() => useSort(rows, getters), { wrapper: strict });
    act(() => result.current.toggleSort('name'));
    act(() => result.current.toggleSort('name')); // name: desc
    act(() => result.current.toggleSort('size')); // đổi cột — phải về asc, không kế thừa desc
    expect(result.current.directionFor('size')).toBe('asc');
    expect(result.current.directionFor('name')).toBeNull();
    expect(result.current.sorted.map((r) => r.size)).toEqual([1, 2, 3]);
  });

  it('defaultKey đặt cột sort ban đầu mà không cần bấm', () => {
    const { result } = renderHook(() => useSort(rows, getters, 'size'), { wrapper: strict });
    expect(result.current.directionFor('size')).toBe('asc');
    expect(result.current.sorted.map((r) => r.size)).toEqual([1, 2, 3]);
  });
});
