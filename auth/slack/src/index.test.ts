import { createHmac } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { MastraAuthSlack } from './index';

// Mock @slack/web-api
vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    auth: {
      test: vi.fn(),
    },
    users: {
      info: vi.fn(),
    },
    oauth: {
      v2: {
        access: vi.fn(),
      },
    },
  })),
}));

describe('MastraAuthSlack', () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-bot-token';
    process.env.SLACK_CLIENT_ID = 'test-client-id';
    process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;
  });

  describe('constructor', () => {
    test('initializes with environment variables', () => {
      const slack = new MastraAuthSlack();
      expect(slack['signingSecret']).toBe('test-signing-secret');
      expect(slack['botToken']).toBe('xoxb-test-bot-token');
      expect(slack['mode']).toBe('both');
    });

    test('initializes with provided options', () => {
      const slack = new MastraAuthSlack({
        signingSecret: 'custom-signing-secret',
        botToken: 'xoxb-custom-token',
        mode: 'webhook',
      });
      expect(slack['signingSecret']).toBe('custom-signing-secret');
      expect(slack['botToken']).toBe('xoxb-custom-token');
      expect(slack['mode']).toBe('webhook');
    });

    test('throws error when signing secret is missing in webhook mode', () => {
      delete process.env.SLACK_SIGNING_SECRET;
      expect(() => new MastraAuthSlack({ mode: 'webhook' })).toThrow(
        'Slack signing secret is required for webhook mode',
      );
    });

    test('throws error when bot token is missing in oauth mode', () => {
      delete process.env.SLACK_BOT_TOKEN;
      expect(() => new MastraAuthSlack({ mode: 'oauth' })).toThrow(
        'Slack bot token is required for OAuth mode',
      );
    });

    test('allows custom allowed team IDs', () => {
      const slack = new MastraAuthSlack({
        allowedTeamIds: ['T123', 'T456'],
      });
      expect(slack['allowedTeamIds']).toEqual(['T123', 'T456']);
    });
  });

  describe('verifyWebhookSignature', () => {
    test('verifies valid signature', () => {
      const slack = new MastraAuthSlack();
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = '{"type":"url_verification"}';
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = 'v0=' + createHmac('sha256', 'test-signing-secret')
        .update(sigBasestring, 'utf8')
        .digest('hex');

      const result = slack.verifyWebhookSignature(signature, timestamp, body);
      expect(result).toBe(true);
    });

    test('rejects invalid signature', () => {
      const slack = new MastraAuthSlack();
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = '{"type":"url_verification"}';

      const result = slack.verifyWebhookSignature('v0=invalid', timestamp, body);
      expect(result).toBe(false);
    });

    test('rejects old timestamps (replay attack prevention)', () => {
      const slack = new MastraAuthSlack();
      // Use a timestamp from 10 minutes ago
      const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const body = '{"type":"url_verification"}';
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = 'v0=' + createHmac('sha256', 'test-signing-secret')
        .update(sigBasestring, 'utf8')
        .digest('hex');

      const result = slack.verifyWebhookSignature(signature, timestamp, body);
      expect(result).toBe(false);
    });

    test('returns false when signing secret is not set', () => {
      const slack = new MastraAuthSlack({ mode: 'oauth' });
      // @ts-expect-error - accessing private property for testing
      slack.signingSecret = undefined;

      const result = slack.verifyWebhookSignature('v0=test', '123', '{}');
      expect(result).toBe(false);
    });
  });

  describe('authorizeUser', () => {
    test('returns true for valid user', async () => {
      const slack = new MastraAuthSlack();
      const result = await slack.authorizeUser({
        id: 'U123',
        team_id: 'T123',
        name: 'testuser',
        is_bot: false,
      });
      expect(result).toBe(true);
    });

    test('returns false for null/undefined user', async () => {
      const slack = new MastraAuthSlack();
      const result = await slack.authorizeUser(null as any);
      expect(result).toBe(false);
    });

    test('returns false for user without id', async () => {
      const slack = new MastraAuthSlack();
      const result = await slack.authorizeUser({
        team_id: 'T123',
        name: 'testuser',
        is_bot: false,
      } as any);
      expect(result).toBe(false);
    });

    test('returns true for URL verification request', async () => {
      const slack = new MastraAuthSlack();
      const result = await slack.authorizeUser({
        id: 'slack-verification',
        team_id: 'unknown',
        name: 'URL Verification',
        is_bot: true,
      });
      expect(result).toBe(true);
    });

    test('rejects users from non-allowed teams', async () => {
      const slack = new MastraAuthSlack({
        allowedTeamIds: ['T123'],
      });
      const result = await slack.authorizeUser({
        id: 'U456',
        team_id: 'T789', // Not in allowed list
        name: 'testuser',
        is_bot: false,
      });
      expect(result).toBe(false);
    });

    test('accepts users from allowed teams', async () => {
      const slack = new MastraAuthSlack({
        allowedTeamIds: ['T123', 'T456'],
      });
      const result = await slack.authorizeUser({
        id: 'U789',
        team_id: 'T456', // In allowed list
        name: 'testuser',
        is_bot: false,
      });
      expect(result).toBe(true);
    });

    test('can be overridden with custom authorization logic', async () => {
      const slack = new MastraAuthSlack({
        async authorizeUser(user: any): Promise<boolean> {
          // Custom logic: only allow admins
          return user?.is_admin === true;
        },
      });

      // Test with admin user
      const adminUser = {
        id: 'U123',
        team_id: 'T123',
        name: 'admin',
        is_bot: false,
        is_admin: true,
      };
      expect(await slack.authorizeUser(adminUser)).toBe(true);

      // Test with non-admin user
      const regularUser = {
        id: 'U456',
        team_id: 'T123',
        name: 'regular',
        is_bot: false,
        is_admin: false,
      };
      expect(await slack.authorizeUser(regularUser)).toBe(false);
    });
  });

  describe('getClient', () => {
    test('returns WebClient when bot token is set', () => {
      const slack = new MastraAuthSlack();
      const client = slack.getClient();
      expect(client).toBeDefined();
    });

    test('returns undefined when no bot token', () => {
      delete process.env.SLACK_BOT_TOKEN;
      const slack = new MastraAuthSlack({ mode: 'webhook' });
      const client = slack.getClient();
      expect(client).toBeUndefined();
    });
  });
});
