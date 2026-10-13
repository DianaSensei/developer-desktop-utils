import { describe, expect, it } from 'vitest';
import { CASE_TRANSFORMS } from '@/components/tools/TextTransformer';

describe('Text Transformer case modes', () => {
  it('converts each line on its own instead of merging a list into one identifier', () => {
    expect(CASE_TRANSFORMS.camelcase('user_id\nfirst-name\n\nLastName')).toBe('userId\nfirstName\n\nlastName');
  });

  it('covers every case the tool advertises', () => {
    const src = 'http request id';
    expect(CASE_TRANSFORMS.pascalcase(src)).toBe('HttpRequestId');
    expect(CASE_TRANSFORMS.snakecase(src)).toBe('http_request_id');
    expect(CASE_TRANSFORMS.constantcase(src)).toBe('HTTP_REQUEST_ID');
    expect(CASE_TRANSFORMS.kebabcase(src)).toBe('http-request-id');
    expect(CASE_TRANSFORMS.titlecase('helloWorld again')).toBe('Hello World Again');
  });
});
