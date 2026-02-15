import { createTool } from '@mastra/core/tools';
import { Integration } from '@mastra/core/integration';
import { WebClient } from '@slack/web-api';
import { z } from 'zod';
import type { WebAPICallResult } from '@slack/web-api';

export interface SlackIntegrationConfig {
  /** Slack Bot Token (xoxb-...) */
  botToken?: string;
  /** Slack User Token (xoxp-...) for user-level operations */
  userToken?: string;
}

/**
 * Slack Integration for Mastra.
 *
 * Provides tools for interacting with Slack's Web API, including:
 * - Sending messages to channels
 * - Listing channels and users
 * - Managing reactions
 * - Posting files
 *
 * @example
 * ```typescript
 * const slack = new SlackIntegration({
 *   botToken: process.env.SLACK_BOT_TOKEN,
 * });
 *
 * const tools = slack.listStaticTools();
 * // Use tools in your agents or workflows
 * ```
 */
export class SlackIntegration extends Integration<void, WebClient> {
  name = 'slack';
  private botToken?: string;
  private userToken?: string;
  private client?: WebClient;

  constructor(config?: SlackIntegrationConfig) {
    super();
    this.botToken = config?.botToken ?? process.env.SLACK_BOT_TOKEN;
    this.userToken = config?.userToken ?? process.env.SLACK_USER_TOKEN;

    if (this.botToken) {
      this.client = new WebClient(this.botToken);
    }
  }

  /**
   * Get the Slack Web API client.
   */
  async getApiClient(): Promise<WebClient> {
    if (!this.client) {
      if (!this.botToken) {
        throw new Error(
          'Slack bot token is required. Provide it via constructor or SLACK_BOT_TOKEN environment variable.',
        );
      }
      this.client = new WebClient(this.botToken);
    }
    return this.client;
  }

  /**
   * Get a client with a specific token (useful for user-level operations).
   */
  getClientWithToken(token: string): WebClient {
    return new WebClient(token);
  }

  /**
   * List all available Slack tools.
   */
  listStaticTools() {
    const integration = this;

    return {
      /**
       * Send a message to a Slack channel.
       */
      slack_send_message: createTool({
        id: 'slack_send_message',
        description: 'Send a message to a Slack channel or direct message',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID or name (e.g., #general or C1234567890)'),
          text: z.string().describe('The message text to send'),
          thread_ts: z.string().optional().describe('Thread timestamp to reply to (for threading)'),
          mrkdwn: z.boolean().optional().default(true).describe('Whether to parse markdown in the message'),
          unfurl_links: z.boolean().optional().default(true).describe('Whether to unfurl links'),
          unfurl_media: z.boolean().optional().default(true).describe('Whether to unfurl media'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channel: z.string().optional(),
          ts: z.string().optional().describe('Timestamp of the message (used for threading)'),
          message: z.object({
            text: z.string().optional(),
            user: z.string().optional(),
            ts: z.string().optional(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.chat.postMessage({
            channel: input.channel,
            text: input.text,
            thread_ts: input.thread_ts,
            mrkdwn: input.mrkdwn,
            unfurl_links: input.unfurl_links,
            unfurl_media: input.unfurl_media,
          });
          return result as {
            ok: boolean;
            channel?: string;
            ts?: string;
            message?: { text?: string; user?: string; ts?: string };
            error?: string;
          };
        },
      }),

      /**
       * Update an existing message.
       */
      slack_update_message: createTool({
        id: 'slack_update_message',
        description: 'Update an existing Slack message',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID where the message exists'),
          ts: z.string().describe('Timestamp of the message to update'),
          text: z.string().describe('The new message text'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channel: z.string().optional(),
          ts: z.string().optional(),
          text: z.string().optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.chat.update({
            channel: input.channel,
            ts: input.ts,
            text: input.text,
          });
          return result as {
            ok: boolean;
            channel?: string;
            ts?: string;
            text?: string;
            error?: string;
          };
        },
      }),

      /**
       * Delete a message.
       */
      slack_delete_message: createTool({
        id: 'slack_delete_message',
        description: 'Delete a Slack message',
        requireApproval: true,
        inputSchema: z.object({
          channel: z.string().describe('Channel ID where the message exists'),
          ts: z.string().describe('Timestamp of the message to delete'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channel: z.string().optional(),
          ts: z.string().optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.chat.delete({
            channel: input.channel,
            ts: input.ts,
          });
          return result as {
            ok: boolean;
            channel?: string;
            ts?: string;
            error?: string;
          };
        },
      }),

      /**
       * List channels in the workspace.
       */
      slack_list_channels: createTool({
        id: 'slack_list_channels',
        description: 'List channels in the Slack workspace',
        inputSchema: z.object({
          types: z.string().optional().default('public_channel,private_channel')
            .describe('Comma-separated types: public_channel, private_channel, mpim, im'),
          limit: z.number().optional().default(100).describe('Maximum number of channels to return'),
          exclude_archived: z.boolean().optional().default(true).describe('Exclude archived channels'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channels: z.array(z.object({
            id: z.string(),
            name: z.string().optional(),
            is_channel: z.boolean().optional(),
            is_private: z.boolean().optional(),
            is_archived: z.boolean().optional(),
            num_members: z.number().optional(),
            topic: z.object({ value: z.string() }).optional(),
            purpose: z.object({ value: z.string() }).optional(),
          })).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.list({
            types: input.types,
            limit: input.limit,
            exclude_archived: input.exclude_archived,
          });
          return result as {
            ok: boolean;
            channels?: Array<{
              id: string;
              name?: string;
              is_channel?: boolean;
              is_private?: boolean;
              is_archived?: boolean;
              num_members?: number;
              topic?: { value: string };
              purpose?: { value: string };
            }>;
            error?: string;
          };
        },
      }),

      /**
       * Get channel info.
       */
      slack_get_channel_info: createTool({
        id: 'slack_get_channel_info',
        description: 'Get detailed information about a Slack channel',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID'),
          include_num_members: z.boolean().optional().default(true),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channel: z.object({
            id: z.string(),
            name: z.string().optional(),
            is_channel: z.boolean().optional(),
            is_private: z.boolean().optional(),
            is_archived: z.boolean().optional(),
            is_member: z.boolean().optional(),
            num_members: z.number().optional(),
            topic: z.object({ value: z.string() }).optional(),
            purpose: z.object({ value: z.string() }).optional(),
            created: z.number().optional(),
            creator: z.string().optional(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.info({
            channel: input.channel,
            include_num_members: input.include_num_members,
          });
          return result as {
            ok: boolean;
            channel?: {
              id: string;
              name?: string;
              is_channel?: boolean;
              is_private?: boolean;
              is_archived?: boolean;
              is_member?: boolean;
              num_members?: number;
              topic?: { value: string };
              purpose?: { value: string };
              created?: number;
              creator?: string;
            };
            error?: string;
          };
        },
      }),

      /**
       * List users in the workspace.
       */
      slack_list_users: createTool({
        id: 'slack_list_users',
        description: 'List users in the Slack workspace',
        inputSchema: z.object({
          limit: z.number().optional().default(100).describe('Maximum number of users to return'),
          include_locale: z.boolean().optional().default(false),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          members: z.array(z.object({
            id: z.string(),
            name: z.string().optional(),
            real_name: z.string().optional(),
            is_admin: z.boolean().optional(),
            is_owner: z.boolean().optional(),
            is_bot: z.boolean().optional(),
            deleted: z.boolean().optional(),
            profile: z.object({
              email: z.string().optional(),
              display_name: z.string().optional(),
              image_48: z.string().optional(),
            }).optional(),
          })).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.users.list({
            limit: input.limit,
            include_locale: input.include_locale,
          });
          return result as {
            ok: boolean;
            members?: Array<{
              id: string;
              name?: string;
              real_name?: string;
              is_admin?: boolean;
              is_owner?: boolean;
              is_bot?: boolean;
              deleted?: boolean;
              profile?: {
                email?: string;
                display_name?: string;
                image_48?: string;
              };
            }>;
            error?: string;
          };
        },
      }),

      /**
       * Get user info.
       */
      slack_get_user_info: createTool({
        id: 'slack_get_user_info',
        description: 'Get detailed information about a Slack user',
        inputSchema: z.object({
          user: z.string().describe('User ID'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          user: z.object({
            id: z.string(),
            name: z.string().optional(),
            real_name: z.string().optional(),
            is_admin: z.boolean().optional(),
            is_owner: z.boolean().optional(),
            is_bot: z.boolean().optional(),
            deleted: z.boolean().optional(),
            tz: z.string().optional(),
            profile: z.object({
              email: z.string().optional(),
              display_name: z.string().optional(),
              image_48: z.string().optional(),
              image_72: z.string().optional(),
              status_text: z.string().optional(),
              status_emoji: z.string().optional(),
            }).optional(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.users.info({
            user: input.user,
          });
          return result as {
            ok: boolean;
            user?: {
              id: string;
              name?: string;
              real_name?: string;
              is_admin?: boolean;
              is_owner?: boolean;
              is_bot?: boolean;
              deleted?: boolean;
              tz?: string;
              profile?: {
                email?: string;
                display_name?: string;
                image_48?: string;
                image_72?: string;
                status_text?: string;
                status_emoji?: string;
              };
            };
            error?: string;
          };
        },
      }),

      /**
       * Add a reaction to a message.
       */
      slack_add_reaction: createTool({
        id: 'slack_add_reaction',
        description: 'Add an emoji reaction to a Slack message',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID where the message exists'),
          timestamp: z.string().describe('Timestamp of the message to react to'),
          name: z.string().describe('Emoji name without colons (e.g., "thumbsup")'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.reactions.add({
            channel: input.channel,
            timestamp: input.timestamp,
            name: input.name,
          });
          return result as { ok: boolean; error?: string };
        },
      }),

      /**
       * Remove a reaction from a message.
       */
      slack_remove_reaction: createTool({
        id: 'slack_remove_reaction',
        description: 'Remove an emoji reaction from a Slack message',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID where the message exists'),
          timestamp: z.string().describe('Timestamp of the message'),
          name: z.string().describe('Emoji name without colons (e.g., "thumbsup")'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.reactions.remove({
            channel: input.channel,
            timestamp: input.timestamp,
            name: input.name,
          });
          return result as { ok: boolean; error?: string };
        },
      }),

      /**
       * Get message history from a channel.
       */
      slack_get_channel_history: createTool({
        id: 'slack_get_channel_history',
        description: 'Get message history from a Slack channel',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID'),
          limit: z.number().optional().default(20).describe('Maximum number of messages to return'),
          oldest: z.string().optional().describe('Only messages after this timestamp'),
          latest: z.string().optional().describe('Only messages before this timestamp'),
          inclusive: z.boolean().optional().default(false).describe('Include messages with oldest/latest timestamps'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          messages: z.array(z.object({
            type: z.string().optional(),
            user: z.string().optional(),
            text: z.string().optional(),
            ts: z.string(),
            thread_ts: z.string().optional(),
            reply_count: z.number().optional(),
          })).optional(),
          has_more: z.boolean().optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.history({
            channel: input.channel,
            limit: input.limit,
            oldest: input.oldest,
            latest: input.latest,
            inclusive: input.inclusive,
          });
          return result as {
            ok: boolean;
            messages?: Array<{
              type?: string;
              user?: string;
              text?: string;
              ts: string;
              thread_ts?: string;
              reply_count?: number;
            }>;
            has_more?: boolean;
            error?: string;
          };
        },
      }),

      /**
       * Get replies in a thread.
       */
      slack_get_thread_replies: createTool({
        id: 'slack_get_thread_replies',
        description: 'Get all replies in a Slack thread',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID where the thread exists'),
          ts: z.string().describe('Timestamp of the parent message'),
          limit: z.number().optional().default(50).describe('Maximum number of replies to return'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          messages: z.array(z.object({
            type: z.string().optional(),
            user: z.string().optional(),
            text: z.string().optional(),
            ts: z.string(),
            thread_ts: z.string().optional(),
          })).optional(),
          has_more: z.boolean().optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.replies({
            channel: input.channel,
            ts: input.ts,
            limit: input.limit,
          });
          return result as {
            ok: boolean;
            messages?: Array<{
              type?: string;
              user?: string;
              text?: string;
              ts: string;
              thread_ts?: string;
            }>;
            has_more?: boolean;
            error?: string;
          };
        },
      }),

      /**
       * Join a channel.
       */
      slack_join_channel: createTool({
        id: 'slack_join_channel',
        description: 'Join a Slack channel',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID to join'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channel: z.object({
            id: z.string(),
            name: z.string().optional(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.join({
            channel: input.channel,
          });
          return result as {
            ok: boolean;
            channel?: { id: string; name?: string };
            error?: string;
          };
        },
      }),

      /**
       * Leave a channel.
       */
      slack_leave_channel: createTool({
        id: 'slack_leave_channel',
        description: 'Leave a Slack channel',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID to leave'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.leave({
            channel: input.channel,
          });
          return result as { ok: boolean; error?: string };
        },
      }),

      /**
       * Set channel topic.
       */
      slack_set_channel_topic: createTool({
        id: 'slack_set_channel_topic',
        description: 'Set the topic for a Slack channel',
        inputSchema: z.object({
          channel: z.string().describe('Channel ID'),
          topic: z.string().describe('New topic for the channel'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          topic: z.string().optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.setTopic({
            channel: input.channel,
            topic: input.topic,
          });
          return result as { ok: boolean; topic?: string; error?: string };
        },
      }),

      /**
       * Search messages.
       */
      slack_search_messages: createTool({
        id: 'slack_search_messages',
        description: 'Search for messages in Slack (requires user token)',
        inputSchema: z.object({
          query: z.string().describe('Search query (supports Slack search modifiers)'),
          count: z.number().optional().default(20).describe('Maximum number of results'),
          sort: z.enum(['score', 'timestamp']).optional().default('score').describe('Sort order'),
          sort_dir: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          messages: z.object({
            total: z.number().optional(),
            matches: z.array(z.object({
              type: z.string().optional(),
              channel: z.object({ id: z.string(), name: z.string().optional() }).optional(),
              user: z.string().optional(),
              username: z.string().optional(),
              text: z.string().optional(),
              ts: z.string().optional(),
              permalink: z.string().optional(),
            })).optional(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          // Search requires a user token
          const token = integration.userToken || integration.botToken;
          if (!token) {
            return { ok: false, error: 'User token required for search' };
          }
          const client = new WebClient(token);
          const result = await client.search.messages({
            query: input.query,
            count: input.count,
            sort: input.sort,
            sort_dir: input.sort_dir,
          });
          return result as {
            ok: boolean;
            messages?: {
              total?: number;
              matches?: Array<{
                type?: string;
                channel?: { id: string; name?: string };
                user?: string;
                username?: string;
                text?: string;
                ts?: string;
                permalink?: string;
              }>;
            };
            error?: string;
          };
        },
      }),

      /**
       * Upload a file.
       */
      slack_upload_file: createTool({
        id: 'slack_upload_file',
        description: 'Upload a file to Slack',
        inputSchema: z.object({
          channels: z.string().describe('Comma-separated list of channel IDs'),
          content: z.string().describe('File content as a string'),
          filename: z.string().optional().describe('Filename for the upload'),
          filetype: z.string().optional().describe('File type (e.g., "text", "javascript", "python")'),
          title: z.string().optional().describe('Title of the file'),
          initial_comment: z.string().optional().describe('Initial comment to include with the file'),
          thread_ts: z.string().optional().describe('Thread timestamp to post the file in'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          file: z.object({
            id: z.string(),
            name: z.string().optional(),
            title: z.string().optional(),
            mimetype: z.string().optional(),
            filetype: z.string().optional(),
            permalink: z.string().optional(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.files.uploadV2({
            channel_id: input.channels,
            content: input.content,
            filename: input.filename,
            filetype: input.filetype,
            title: input.title,
            initial_comment: input.initial_comment,
            thread_ts: input.thread_ts,
          });
          return result as {
            ok: boolean;
            file?: {
              id: string;
              name?: string;
              title?: string;
              mimetype?: string;
              filetype?: string;
              permalink?: string;
            };
            error?: string;
          };
        },
      }),

      /**
       * Open a direct message channel with a user.
       */
      slack_open_dm: createTool({
        id: 'slack_open_dm',
        description: 'Open a direct message channel with a user',
        inputSchema: z.object({
          users: z.string().describe('Comma-separated list of user IDs (1 for DM, multiple for group DM)'),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          channel: z.object({
            id: z.string(),
          }).optional(),
          error: z.string().optional(),
        }),
        execute: async (input) => {
          const client = await integration.getApiClient();
          const result = await client.conversations.open({
            users: input.users,
          });
          return result as {
            ok: boolean;
            channel?: { id: string };
            error?: string;
          };
        },
      }),
    };
  }

  /**
   * List tools asynchronously (required by Integration interface).
   */
  async listTools() {
    return this.listStaticTools();
  }
}

// Re-export types
export type { SlackIntegrationConfig };
