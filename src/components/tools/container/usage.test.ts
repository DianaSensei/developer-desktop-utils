import { describe, expect, it } from 'vitest';
import { buildUsageIndex, describeUsers } from '@/components/tools/container/usage';
import { describePruneResult } from '@/components/tools/container/PruneButton';
import type { ContainerSummary } from '@/components/tools/container/types';

const CONTAINERS: ContainerSummary[] = [
  {
    Id: 'aaaa1111',
    Names: ['/web-1'],
    ImageID: 'sha256:img-nginx',
    Mounts: [
      { Type: 'volume', Name: 'site-data', Destination: '/usr/share/nginx/html' },
      { Type: 'bind', Source: '/Users/me/conf', Destination: '/etc/nginx/conf.d' },
    ],
    NetworkSettings: { Networks: { frontend: { IPAddress: '172.20.0.3' }, bridge: {} } },
  },
  {
    Id: 'bbbb2222',
    Names: ['/api-1'],
    ImageID: 'sha256:img-node',
    Mounts: [{ Type: 'volume', Name: 'site-data', Destination: '/data' }],
    NetworkSettings: { Networks: { frontend: {} } },
  },
  {
    Id: 'cccc3333',
    Names: ['/worker'],
    ImageID: 'sha256:img-node',
  },
];

describe('buildUsageIndex', () => {
  it('nhóm container theo image id', () => {
    const index = buildUsageIndex(CONTAINERS);
    expect(index.byImage.get('sha256:img-node')).toEqual(['api-1', 'worker']);
    expect(index.byImage.get('sha256:img-nginx')).toEqual(['web-1']);
    expect(index.byImage.get('sha256:missing')).toBeUndefined();
  });

  it('chỉ tính named volume, bỏ qua bind mount', () => {
    const index = buildUsageIndex(CONTAINERS);
    expect(index.byVolume.get('site-data')).toEqual(['web-1', 'api-1']);
    // Bind mount không có Name nên không tạo khoá nào.
    expect(index.byVolume.size).toBe(1);
  });

  it('nhóm theo tên network, kể cả container gắn nhiều network', () => {
    const index = buildUsageIndex(CONTAINERS);
    expect(index.byNetwork.get('frontend')).toEqual(['web-1', 'api-1']);
    expect(index.byNetwork.get('bridge')).toEqual(['web-1']);
  });

  it('container thiếu Mounts/NetworkSettings không làm hỏng index', () => {
    const index = buildUsageIndex([{ Id: 'dddd4444' }]);
    expect(index.byImage.size).toBe(0);
    expect(index.byVolume.size).toBe(0);
    expect(index.byNetwork.size).toBe(0);
  });

  it('rơi về tên rút gọn từ Id khi container không có Names', () => {
    const index = buildUsageIndex([{ Id: 'ffffffffffffffff', ImageID: 'sha256:x' }]);
    expect(index.byImage.get('sha256:x')).toEqual(['ffffffffffff']);
  });
});

describe('describeUsers', () => {
  it('nói rõ khi không có container nào dùng', () => {
    expect(describeUsers(undefined)).toBe('Not used by any container');
    expect(describeUsers([])).toBe('Not used by any container');
  });

  it('cắt bớt danh sách dài', () => {
    expect(describeUsers(['a', 'b'])).toBe('a, b');
    expect(describeUsers(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toBe('a, b, c, d +2 more');
  });
});

describe('describePruneResult', () => {
  it('báo rõ khi không có gì để xoá', () => {
    expect(describePruneResult({ deleted: 0, spaceReclaimed: 0 }, 'images')).toBe('No unused images to remove.');
  });

  it('gộp số lượng và dung lượng thu hồi', () => {
    expect(describePruneResult({ deleted: 3, spaceReclaimed: 1024 * 1024 }, 'images'))
      .toBe('Removed 3 images · reclaimed 1.0 MB.');
  });

  it('bỏ phần dung lượng khi endpoint không thu hồi byte nào (networks)', () => {
    expect(describePruneResult({ deleted: 2, spaceReclaimed: 0 }, 'networks')).toBe('Removed 2 networks.');
  });
});
