# 021: キーワード検索API実装

## 概要
YouTube Data API v3を使用してキーワードから動画を検索し、詳細情報（タグ含む）を取得するAPI Routeを実装する。

## 要件
- YouTube search.list APIで50件の動画を取得
- videos.list APIで統計情報・タグを取得
- 30分間のキャッシュ実装
- 既存のエラーハンドリング・レート制限機構との統合
- API クォータ: 150 units/回

## Todo
- [x] API Route作成
  - [x] `/api/youtube/keyword/route.ts`ファイル作成
  - [x] GETリクエストハンドラー実装
  - [x] クエリパラメータ検証（q: 検索キーワード）
- [x] YouTube API統合
  - [x] search.list API呼び出し実装
    - type=video
    - maxResults=50
    - order=viewCount（再生数順）
  - [x] videos.list API呼び出し実装
    - part=snippet,statistics,contentDetails
    - タグ情報取得（snippet.tags）
  - [x] APIレスポンスのデータ変換
- [x] データ処理
  - [x] 動画情報の統合（search結果 + videos詳細）
  - [x] analytics.tsを使った分析指標の計算
  - [x] タグ情報の抽出・整形
  - [x] YouTubeVideo型への変換
- [x] キャッシュ実装
  - [x] キャッシュキー生成: `channel-scope:keyword-search:{query}`
  - [x] getCachedData()ラッパー使用
  - [x] TTL: 30分
- [x] エラーハンドリング
  - [x] 検索キーワード未指定エラー
  - [x] YouTube APIエラー処理
  - [x] エラー分類とメッセージ
  - [x] 適切なHTTPステータスコード返却
- [x] レート制限
  - [x] 既存のrate-limiter統合
  - [x] クォータ使用量の確認
- [x] テスト
  - [x] 正常系テスト（検索成功）- "tutorial"で50件取得確認
  - [x] タグ情報取得確認
  - [x] キャッシュ動作確認（初回APIコール、2回目キャッシュヒット）

## 備考
- Phase: 5 (キーワード検索機能追加)
- 優先度: 高
- 依存関係: 020-project-rename.md
- 所要時間: 2日
- API クォータコスト: 150 units/回（search: 100 + videos: 50）
