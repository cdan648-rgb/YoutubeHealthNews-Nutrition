/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any migration with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 * (or via the Supabase MCP `generate_typescript_types`).
 *
 * Note what is NOT here: the `internal` schema. It is absent because it is not in
 * the Data API's exposed-schema list, which is independent confirmation of the
 * exposure boundary — the browser-facing client literally has no type for, and no
 * route to, subscribers, automation runs, YouTube ingestion or logs. Server-side
 * code reaches those with the service-role key and its own hand-written types.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      articles: {
        Row: {
          article_type: Database['public']['Enums']['article_type'];
          automation_run_id: string | null;
          body_blocks: Json;
          body_text: string;
          category_id: string;
          created_at: string;
          dek: string;
          generated_at: string | null;
          hero_alt: string | null;
          hero_attribution: string | null;
          hero_image_url: string | null;
          hero_kind: Database['public']['Enums']['hero_kind'];
          id: string;
          is_fact_check: boolean;
          published_at: string | null;
          published_date_hanoi: string | null;
          reading_minutes: number | null;
          references_used: Json;
          research_source_id: string | null;
          seo: Json;
          slug: string;
          source_doi: string | null;
          source_metadata: Json;
          source_video_id: string | null;
          source_video_url: string | null;
          source_video_youtube_id: string | null;
          status: Database['public']['Enums']['article_status'];
          title: string;
          updated_at: string;
          validation_report: Json | null;
          word_count: number;
        };
        Insert: {
          article_type: Database['public']['Enums']['article_type'];
          automation_run_id?: string | null;
          body_blocks: Json;
          body_text: string;
          category_id: string;
          created_at?: string;
          dek: string;
          generated_at?: string | null;
          hero_alt?: string | null;
          hero_attribution?: string | null;
          hero_image_url?: string | null;
          hero_kind?: Database['public']['Enums']['hero_kind'];
          id?: string;
          is_fact_check?: boolean;
          published_at?: string | null;
          published_date_hanoi?: string | null;
          reading_minutes?: number | null;
          references_used?: Json;
          research_source_id?: string | null;
          seo?: Json;
          slug: string;
          source_doi?: string | null;
          source_metadata?: Json;
          source_video_id?: string | null;
          source_video_url?: string | null;
          source_video_youtube_id?: string | null;
          status?: Database['public']['Enums']['article_status'];
          title: string;
          updated_at?: string;
          validation_report?: Json | null;
          word_count: number;
        };
        Update: {
          article_type?: Database['public']['Enums']['article_type'];
          automation_run_id?: string | null;
          body_blocks?: Json;
          body_text?: string;
          category_id?: string;
          created_at?: string;
          dek?: string;
          generated_at?: string | null;
          hero_alt?: string | null;
          hero_attribution?: string | null;
          hero_image_url?: string | null;
          hero_kind?: Database['public']['Enums']['hero_kind'];
          id?: string;
          is_fact_check?: boolean;
          published_at?: string | null;
          published_date_hanoi?: string | null;
          reading_minutes?: number | null;
          references_used?: Json;
          research_source_id?: string | null;
          seo?: Json;
          slug?: string;
          source_doi?: string | null;
          source_metadata?: Json;
          source_video_id?: string | null;
          source_video_url?: string | null;
          source_video_youtube_id?: string | null;
          status?: Database['public']['Enums']['article_status'];
          title?: string;
          updated_at?: string;
          validation_report?: Json | null;
          word_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'articles_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'articles_research_source_id_fkey';
            columns: ['research_source_id'];
            isOneToOne: false;
            referencedRelation: 'research_sources';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          color_token: string;
          created_at: string;
          description: string;
          icon_key: string;
          id: string;
          is_active: boolean;
          keywords: string[];
          name: string;
          seo_description: string | null;
          seo_title: string | null;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          color_token: string;
          created_at?: string;
          description: string;
          icon_key: string;
          id?: string;
          is_active?: boolean;
          keywords?: string[];
          name: string;
          seo_description?: string | null;
          seo_title?: string | null;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          color_token?: string;
          created_at?: string;
          description?: string;
          icon_key?: string;
          id?: string;
          is_active?: boolean;
          keywords?: string[];
          name?: string;
          seo_description?: string | null;
          seo_title?: string | null;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      research_sources: {
        Row: {
          abstract: string | null;
          authors: Json;
          cited_by_count: number | null;
          created_at: string;
          discovered_at: string;
          doi_normalized: string | null;
          doi_raw: string | null;
          external_ids: Json;
          id: string;
          is_open_access: boolean | null;
          issn: string | null;
          journal: string | null;
          publication_date: string | null;
          score: number | null;
          score_components: Json | null;
          source_url: string;
          source_url_norm: string | null;
          source_url_sha256: string | null;
          title: string;
          title_fingerprint: string | null;
          updated_at: string;
          used_at: string | null;
        };
        Insert: {
          abstract?: string | null;
          authors?: Json;
          cited_by_count?: number | null;
          created_at?: string;
          discovered_at?: string;
          doi_normalized?: string | null;
          doi_raw?: string | null;
          external_ids?: Json;
          id?: string;
          is_open_access?: boolean | null;
          issn?: string | null;
          journal?: string | null;
          publication_date?: string | null;
          score?: number | null;
          score_components?: Json | null;
          source_url: string;
          source_url_norm?: string | null;
          source_url_sha256?: string | null;
          title: string;
          title_fingerprint?: string | null;
          updated_at?: string;
          used_at?: string | null;
        };
        Update: {
          abstract?: string | null;
          authors?: Json;
          cited_by_count?: number | null;
          created_at?: string;
          discovered_at?: string;
          doi_normalized?: string | null;
          doi_raw?: string | null;
          external_ids?: Json;
          id?: string;
          is_open_access?: boolean | null;
          issn?: string | null;
          journal?: string | null;
          publication_date?: string | null;
          score?: number | null;
          score_components?: Json | null;
          source_url?: string;
          source_url_norm?: string | null;
          source_url_sha256?: string | null;
          title?: string;
          title_fingerprint?: string | null;
          updated_at?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      article_status: 'draft' | 'needs_review' | 'scheduled' | 'published' | 'archived';
      article_type: 'youtube' | 'research';
      hero_kind: 'youtube_thumbnail' | 'svg' | 'none';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      article_status: ['draft', 'needs_review', 'scheduled', 'published', 'archived'],
      article_type: ['youtube', 'research'],
      hero_kind: ['youtube_thumbnail', 'svg', 'none'],
    },
  },
} as const;
