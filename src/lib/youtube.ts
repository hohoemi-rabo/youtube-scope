import { YouTubeChannel, YouTubeVideo, VideoStatistics, VideoContentDetails } from '@/types';
import {
  calculateDaysSincePublished,
  calculateGrowthRate,
  calculateCommentRate,
  calculateLikeRate,
  calculateEngagementRate,
  isTrending,
  isNew,
} from './analytics';

// YouTube API レスポンスの型定義
interface YouTubeAPIItem {
  id: string | { channelId: string; videoId: string };
  snippet: {
    title: string;
    description: string;
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
    customUrl?: string;
    publishedAt: string;
    channelId?: string;
    channelTitle?: string;
    resourceId?: { videoId: string };
    tags?: string[]; // タグ情報（Phase 5追加）
  };
  statistics?: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
    relatedPlaylists?: {
      uploads?: string;
    };
  };
}

const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.error('YouTube API key is not configured');
}

/**
 * YouTube API クライアント
 */
class YouTubeAPIClient {
  private apiKey: string;

  constructor() {
    if (!API_KEY) {
      console.error('YOUTUBE_API_KEY is not set. Current value:', API_KEY);
      throw new Error('YouTube API key is not configured. Please set YOUTUBE_API_KEY in your .env.local file');
    }
    this.apiKey = API_KEY;
    console.log('YouTube API Client initialized successfully');
  }

  /**
   * APIリクエストを送信
   */
  private async fetchAPI(endpoint: string, params: Record<string, string> = {}) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}${endpoint}`);
    url.searchParams.append('key', this.apiKey);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    console.log('Fetching YouTube API:', url.toString().replace(this.apiKey, 'HIDDEN'));

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Response Error:', response.status, errorText);

        try {
          const error = JSON.parse(errorText);
          throw new Error(error.error?.message || `API Error: ${response.status}`);
        } catch {
          throw new Error(`API Error: ${response.status} - ${errorText}`);
        }
      }

      return await response.json();
    } catch (error) {
      console.error('YouTube API Error:', error);
      throw error;
    }
  }

  /**
   * チャンネル名で検索
   */
  async searchChannels(query: string): Promise<YouTubeChannel[]> {
    try {
      const searchResponse = await this.fetchAPI('/search', {
        part: 'snippet',
        type: 'channel',
        q: query,
        maxResults: '10',
      });

      if (!searchResponse.items || searchResponse.items.length === 0) {
        return [];
      }

      // チャンネルIDのリストを取得
      const channelIds = searchResponse.items.map((item: YouTubeAPIItem) => {
        if (typeof item.id === 'object' && 'channelId' in item.id) {
          return item.id.channelId;
        }
        return '';
      }).filter(Boolean).join(',');

      // チャンネルの詳細情報を取得
      const channelsResponse = await this.fetchAPI('/channels', {
        part: 'snippet,statistics',
        id: channelIds,
      });

      return channelsResponse.items ? channelsResponse.items.map((item: YouTubeAPIItem) => ({
        id: typeof item.id === 'string' ? item.id : '',
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
        customUrl: item.snippet.customUrl,
        subscriberCount: parseInt(item.statistics?.subscriberCount || '0'),
        videoCount: parseInt(item.statistics?.videoCount || '0'),
        viewCount: parseInt(item.statistics?.viewCount || '0'),
        publishedAt: item.snippet.publishedAt,
      })) : [];
    } catch (error) {
      console.error('Error searching channels:', error);
      throw error;
    }
  }

  /**
   * チャンネルIDから詳細情報を取得
   */
  async getChannelById(channelId: string): Promise<YouTubeChannel | null> {
    try {
      const response = await this.fetchAPI('/channels', {
        part: 'snippet,statistics',
        id: channelId,
      });

      if (!response.items || response.items.length === 0) {
        return null;
      }

      const item = response.items[0];
      return {
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
        customUrl: item.snippet.customUrl,
        subscriberCount: parseInt(item.statistics.subscriberCount || '0'),
        videoCount: parseInt(item.statistics.videoCount || '0'),
        viewCount: parseInt(item.statistics.viewCount || '0'),
        publishedAt: item.snippet.publishedAt,
      };
    } catch (error) {
      console.error('Error fetching channel:', error);
      throw error;
    }
  }

  /**
   * チャンネルの動画リストを取得
   */
  async getChannelVideos(channelId: string, maxResults: number = 50): Promise<YouTubeVideo[]> {
    try {
      console.log(`Getting videos for channel: ${channelId}, maxResults: ${maxResults}`);

      // まずチャンネル情報を取得してuploadPlaylistIdを取得
      const channelResponse = await this.fetchAPI('/channels', {
        part: 'contentDetails',
        id: channelId,
      });

      if (channelResponse.items?.[0]?.contentDetails?.relatedPlaylists?.uploads) {
        const uploadsPlaylistId = channelResponse.items[0].contentDetails.relatedPlaylists.uploads;
        console.log(`Using uploads playlist: ${uploadsPlaylistId}`);

        // playlistItemsを使って動画を取得
        const playlistResponse = await this.fetchAPI('/playlistItems', {
          part: 'snippet',
          playlistId: uploadsPlaylistId,
          maxResults: maxResults.toString(),
        });

        console.log(`Playlist response items count: ${playlistResponse.items?.length || 0}`);

        if (playlistResponse.items?.length > 0) {
          return this.processVideoData(playlistResponse.items, channelId, 'playlist');
        }
      }

      // フォールバック: 従来のsearch方式
      console.log('Falling back to search API');
      const searchResponse = await this.fetchAPI('/search', {
        part: 'snippet',
        channelId: channelId,
        order: 'date',
        type: 'video',
        maxResults: maxResults.toString(),
      });

      console.log(`Search response items count: ${searchResponse.items?.length || 0}`);

      if (!searchResponse.items || searchResponse.items.length === 0) {
        console.log('No videos found in search response');
        return [];
      }

      return this.processVideoData(searchResponse.items, channelId, 'search');
    } catch (error) {
      console.error('Error fetching channel videos:', error);
      throw error;
    }
  }

  /**
   * 動画データを処理する共通メソッド
   */
  private async processVideoData(items: YouTubeAPIItem[], channelId: string, source: 'playlist' | 'search'): Promise<YouTubeVideo[]> {
    try {
      // 動画IDのリストを取得
      const videoIds = items.map((item: YouTubeAPIItem) => {
        if (source === 'playlist') {
          return item.snippet.resourceId?.videoId;
        } else {
          return typeof item.id === 'object' && 'videoId' in item.id ? item.id.videoId : '';
        }
      }).filter(Boolean).join(',');

      console.log(`Video IDs (${source}): ${videoIds}`);

      // 動画の詳細情報（統計と時間）を取得
      const videosResponse = await this.fetchAPI('/videos', {
        part: 'statistics,contentDetails',
        id: videoIds,
      });

      console.log(`Videos response items count: ${videosResponse.items?.length || 0}`);

      // 動画情報をマップに変換
      const videoDetailsMap = new Map<string, { statistics: VideoStatistics; contentDetails: VideoContentDetails }>();
      videosResponse.items?.forEach((item: YouTubeAPIItem) => {
        if (typeof item.id === 'string') {
          videoDetailsMap.set(item.id, {
            statistics: item.statistics as VideoStatistics,
            contentDetails: item.contentDetails as VideoContentDetails,
          });
        }
      });

      // 結果を整形
      return items.map((item: YouTubeAPIItem) => {
        const videoId = source === 'playlist'
          ? item.snippet.resourceId?.videoId || ''
          : (typeof item.id === 'object' && 'videoId' in item.id ? item.id.videoId : '');
        const details = videoDetailsMap.get(videoId || '');
        const publishedAt = item.snippet.publishedAt;

        const viewCount = parseInt(details?.statistics?.viewCount || '0');
        const likeCount = parseInt(details?.statistics?.likeCount || '0');
        const commentCount = parseInt(details?.statistics?.commentCount || '0');

        // 分析指標を計算
        const daysFromPublished = calculateDaysSincePublished(publishedAt);
        const growthRate = calculateGrowthRate(viewCount, publishedAt);
        const commentRate = calculateCommentRate(commentCount, viewCount);
        const likeRate = calculateLikeRate(likeCount, viewCount);
        const engagementRate = calculateEngagementRate(likeCount, commentCount, viewCount);

        return {
          id: videoId,
          channelId: channelId,
          title: item.snippet.title,
          description: item.snippet.description,
          thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
          publishedAt,
          duration: this.parseDuration(details?.contentDetails?.duration || 'PT0S'),
          viewCount,
          likeCount,
          commentCount,
          daysFromPublished,
          growthRate,
          commentRate,
          likeRate,
          engagementRate,
          isTrending: isTrending(growthRate, publishedAt),
          isNew: isNew(publishedAt),
        };
      });
    } catch (error) {
      console.error('Error processing video data:', error);
      throw error;
    }
  }

  /**
   * ISO 8601形式の動画時間を読みやすい形式に変換
   */
  private parseDuration(duration: string): string {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return '0:00';

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * キーワードで動画を検索（Phase 5追加）
   * @param query 検索キーワード
   * @param maxResults 取得する動画数（デフォルト: 50）
   * @returns YouTubeVideo配列（タグ情報含む）
   */
  async searchVideos(query: string, maxResults: number = 50): Promise<YouTubeVideo[]> {
    try {
      console.log(`Searching videos for keyword: "${query}", maxResults: ${maxResults}`);

      // search.list APIで動画を検索（再生数順）
      const searchResponse = await this.fetchAPI('/search', {
        part: 'snippet',
        type: 'video',
        q: query,
        maxResults: maxResults.toString(),
        order: 'viewCount', // 再生数順
      });

      console.log(`Search response items count: ${searchResponse.items?.length || 0}`);

      if (!searchResponse.items || searchResponse.items.length === 0) {
        console.log('No videos found for keyword');
        return [];
      }

      // 動画IDのリストを取得
      const videoIds = searchResponse.items.map((item: YouTubeAPIItem) => {
        return typeof item.id === 'object' && 'videoId' in item.id ? item.id.videoId : '';
      }).filter(Boolean).join(',');

      console.log(`Video IDs from search: ${videoIds.substring(0, 100)}...`);

      // videos.list APIで詳細情報（統計、タグ、時間）を取得
      const videosResponse = await this.fetchAPI('/videos', {
        part: 'snippet,statistics,contentDetails',
        id: videoIds,
      });

      console.log(`Videos response items count: ${videosResponse.items?.length || 0}`);

      // 動画情報をマップに変換（タグ情報含む）
      const videoDetailsMap = new Map<string, YouTubeAPIItem>();
      videosResponse.items?.forEach((item: YouTubeAPIItem) => {
        if (typeof item.id === 'string') {
          videoDetailsMap.set(item.id, item);
        }
      });

      // 結果を整形
      return searchResponse.items.map((item: YouTubeAPIItem) => {
        const videoId = typeof item.id === 'object' && 'videoId' in item.id ? item.id.videoId : '';
        const details = videoDetailsMap.get(videoId);
        const publishedAt = details?.snippet?.publishedAt || item.snippet.publishedAt;

        const viewCount = parseInt(details?.statistics?.viewCount || '0');
        const likeCount = parseInt(details?.statistics?.likeCount || '0');
        const commentCount = parseInt(details?.statistics?.commentCount || '0');

        // 分析指標を計算
        const daysFromPublished = calculateDaysSincePublished(publishedAt);
        const growthRate = calculateGrowthRate(viewCount, publishedAt);
        const commentRate = calculateCommentRate(commentCount, viewCount);
        const likeRate = calculateLikeRate(likeCount, viewCount);
        const engagementRate = calculateEngagementRate(likeCount, commentCount, viewCount);

        return {
          id: videoId,
          channelId: item.snippet.channelId || '',
          channelTitle: item.snippet.channelTitle,
          title: details?.snippet?.title || item.snippet.title,
          description: details?.snippet?.description || item.snippet.description,
          thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
          publishedAt,
          duration: this.parseDuration(details?.contentDetails?.duration || 'PT0S'),
          viewCount,
          likeCount,
          commentCount,
          tags: details?.snippet?.tags || [], // タグ情報を追加
          daysFromPublished,
          growthRate,
          commentRate,
          likeRate,
          engagementRate,
          isTrending: isTrending(growthRate, publishedAt),
          isNew: isNew(publishedAt),
        };
      }).filter((video: YouTubeVideo) => video.id); // 空のIDを除外
    } catch (error) {
      console.error('Error searching videos:', error);
      throw error;
    }
  }

  /**
   * API使用量の計算（参考用）
   */
  calculateQuotaCost(operation: 'search' | 'channelDetails' | 'videoList' | 'keywordSearch'): number {
    const costs = {
      search: 100,
      channelDetails: 3,
      videoList: 100 + 3, // search + video details
      keywordSearch: 100 + 50, // search.list (100) + videos.list (50)
    };
    return costs[operation];
  }
}

// シングルトンインスタンスをエクスポート
const youtubeClient = new YouTubeAPIClient();
export default youtubeClient;