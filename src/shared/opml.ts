export interface OpmlFeed {
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  folderName: string | null;
}

export interface OpmlImportResult {
  status: 'imported' | 'existing' | 'failed';
  foldersCreated: number;
  error?: string;
  failureSaved?: boolean;
  // 피드 제공 경로가 모두 요청 한도에 걸렸을 때, 다시 시도해도 되는 시점까지 남은 초.
  retryAfter?: number;
}

export interface OpmlImportFailure {
  item: OpmlFeed;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  suggestedUrl: string | null;
}
