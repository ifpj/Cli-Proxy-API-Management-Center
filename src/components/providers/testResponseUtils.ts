const TEST_RESPONSE_PREVIEW_MAX_LENGTH = 8_000;

export const formatTestResponseBody = (body: unknown, bodyText: string): string => {
  if (body !== null && typeof body === 'object') {
    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return bodyText;
    }
  }
  return bodyText;
};

export const truncateTestResponse = (text: string): string => {
  if (text.length <= TEST_RESPONSE_PREVIEW_MAX_LENGTH) return text;
  return `${text.slice(0, TEST_RESPONSE_PREVIEW_MAX_LENGTH)}\n...`;
};

