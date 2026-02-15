import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { SlackIntegration } from './index';

// Mock @slack/web-api
const mockPostMessage = vi.fn();
const mockUpdateMessage = vi.fn();
const mockDeleteMessage = vi.fn();
const mockConversationsList = vi.fn();
const mockConversationsInfo = vi.fn();
const mockConversationsHistory = vi.fn();
const mockConversationsReplies = vi.fn();
const mockConversationsJoin = vi.fn();
const mockConversationsLeave = vi.fn();
const mockConversationsSetTopic = vi.fn();
const mockConversationsOpen = vi.fn();
const mockUsersList = vi.fn();
const mockUsersInfo = vi.fn();
const mockReactionsAdd = vi.fn();
const mockReactionsRemove = vi.fn();
const mockSearchMessages = vi.fn();
const mockFilesUpload = vi.fn();

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: {
      postMessage: mockPostMessage,
      update: mockUpdateMessage,
      delete: mockDeleteMessage,
    },
    conversations: {
      list: mockConversationsList,
      info: mockConversationsInfo,
      history: mockConversationsHistory,
      replies: mockConversationsReplies,
      join: mockConversationsJoin,
      leave: mockConversationsLeave,
      setTopic: mockConversationsSetTopic,
      open: mockConversationsOpen,
    },
    users: {
      list: mockUsersList,
      info: mockUsersInfo,
    },
    reactions: {
      add: mockReactionsAdd,
      remove: mockReactionsRemove,
    },
    search: {
      messages: mockSearchMessages,
    },
    files: {
      uploadV2: mockFilesUpload,
    },
  })),
}));

describe('SlackIntegration', () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
  });

  describe('constructor', () => {
    test('initializes with environment variables', () => {
      const slack = new SlackIntegration();
      expect(slack.name).toBe('slack');
    });

    test('initializes with provided config', () => {
      const slack = new SlackIntegration({
        botToken: 'xoxb-custom-token',
        userToken: 'xoxp-custom-token',
      });
      expect(slack.name).toBe('slack');
    });
  });

  describe('getApiClient', () => {
    test('returns WebClient', async () => {
      const slack = new SlackIntegration();
      const client = await slack.getApiClient();
      expect(client).toBeDefined();
    });

    test('throws error when no bot token', async () => {
      delete process.env.SLACK_BOT_TOKEN;
      const slack = new SlackIntegration();
      await expect(slack.getApiClient()).rejects.toThrow('Slack bot token is required');
    });
  });

  describe('listStaticTools', () => {
    test('returns all tools', () => {
      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();

      expect(tools).toHaveProperty('slack_send_message');
      expect(tools).toHaveProperty('slack_update_message');
      expect(tools).toHaveProperty('slack_delete_message');
      expect(tools).toHaveProperty('slack_list_channels');
      expect(tools).toHaveProperty('slack_get_channel_info');
      expect(tools).toHaveProperty('slack_list_users');
      expect(tools).toHaveProperty('slack_get_user_info');
      expect(tools).toHaveProperty('slack_add_reaction');
      expect(tools).toHaveProperty('slack_remove_reaction');
      expect(tools).toHaveProperty('slack_get_channel_history');
      expect(tools).toHaveProperty('slack_get_thread_replies');
      expect(tools).toHaveProperty('slack_join_channel');
      expect(tools).toHaveProperty('slack_leave_channel');
      expect(tools).toHaveProperty('slack_set_channel_topic');
      expect(tools).toHaveProperty('slack_search_messages');
      expect(tools).toHaveProperty('slack_upload_file');
      expect(tools).toHaveProperty('slack_open_dm');
    });

    test('tools have required properties', () => {
      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();

      Object.values(tools).forEach((tool) => {
        expect(tool).toHaveProperty('id');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('execute');
      });
    });
  });

  describe('slack_send_message tool', () => {
    test('sends message to channel', async () => {
      mockPostMessage.mockResolvedValue({
        ok: true,
        channel: 'C123',
        ts: '1234567890.123456',
        message: { text: 'Hello', user: 'U123', ts: '1234567890.123456' },
      });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      const result = await tools.slack_send_message.execute?.({
        channel: 'C123',
        text: 'Hello',
      }, {});

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: 'Hello',
        thread_ts: undefined,
        mrkdwn: undefined,
        unfurl_links: undefined,
        unfurl_media: undefined,
      });
      expect(result).toEqual({
        ok: true,
        channel: 'C123',
        ts: '1234567890.123456',
        message: { text: 'Hello', user: 'U123', ts: '1234567890.123456' },
      });
    });

    test('sends threaded reply', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: '1234567890.123457' });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      await tools.slack_send_message.execute?.({
        channel: 'C123',
        text: 'Reply',
        thread_ts: '1234567890.123456',
      }, {});

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: 'Reply',
        thread_ts: '1234567890.123456',
        mrkdwn: undefined,
        unfurl_links: undefined,
        unfurl_media: undefined,
      });
    });
  });

  describe('slack_list_channels tool', () => {
    test('lists channels with default options', async () => {
      mockConversationsList.mockResolvedValue({
        ok: true,
        channels: [
          { id: 'C123', name: 'general', is_private: false },
          { id: 'C456', name: 'random', is_private: false },
        ],
      });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      const result = await tools.slack_list_channels.execute?.({}, {});

      expect(mockConversationsList).toHaveBeenCalledWith({
        types: undefined,
        limit: undefined,
        exclude_archived: undefined,
      });
      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('channels');
    });
  });

  describe('slack_add_reaction tool', () => {
    test('adds reaction to message', async () => {
      mockReactionsAdd.mockResolvedValue({ ok: true });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      const result = await tools.slack_add_reaction.execute?.({
        channel: 'C123',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      }, {});

      expect(mockReactionsAdd).toHaveBeenCalledWith({
        channel: 'C123',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('slack_get_channel_history tool', () => {
    test('retrieves channel history', async () => {
      mockConversationsHistory.mockResolvedValue({
        ok: true,
        messages: [
          { user: 'U123', text: 'Hello', ts: '1234567890.123456' },
          { user: 'U456', text: 'World', ts: '1234567890.123457' },
        ],
        has_more: false,
      });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      const result = await tools.slack_get_channel_history.execute?.({
        channel: 'C123',
        limit: 10,
      }, {});

      expect(mockConversationsHistory).toHaveBeenCalledWith({
        channel: 'C123',
        limit: 10,
        oldest: undefined,
        latest: undefined,
        inclusive: undefined,
      });
      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('messages');
    });
  });

  describe('slack_delete_message tool', () => {
    test('requires approval', () => {
      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      expect(tools.slack_delete_message.requireApproval).toBe(true);
    });

    test('deletes message', async () => {
      mockDeleteMessage.mockResolvedValue({ ok: true, channel: 'C123', ts: '1234567890.123456' });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      const result = await tools.slack_delete_message.execute?.({
        channel: 'C123',
        ts: '1234567890.123456',
      }, {});

      expect(mockDeleteMessage).toHaveBeenCalledWith({
        channel: 'C123',
        ts: '1234567890.123456',
      });
      expect(result).toEqual({ ok: true, channel: 'C123', ts: '1234567890.123456' });
    });
  });

  describe('slack_open_dm tool', () => {
    test('opens DM channel with user', async () => {
      mockConversationsOpen.mockResolvedValue({
        ok: true,
        channel: { id: 'D123' },
      });

      const slack = new SlackIntegration();
      const tools = slack.listStaticTools();
      const result = await tools.slack_open_dm.execute?.({
        users: 'U123',
      }, {});

      expect(mockConversationsOpen).toHaveBeenCalledWith({
        users: 'U123',
      });
      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('channel');
    });
  });

  describe('listTools', () => {
    test('returns same tools as listStaticTools', async () => {
      const slack = new SlackIntegration();
      const staticTools = slack.listStaticTools();
      const asyncTools = await slack.listTools();

      expect(Object.keys(asyncTools)).toEqual(Object.keys(staticTools));
    });
  });
});
