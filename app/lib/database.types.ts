export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accident_cases: {
        Row: {
          accident_type: string | null
          cause: string | null
          created_at: string
          id: string
          industry: string | null
          measures: string | null
          published_date: string | null
          raw_text: string | null
          search_tsv: unknown
          source_org: string
          source_title: string
          source_url: string
          summary: string | null
          tags: string[] | null
          weather_related: string | null
          work_type: string | null
        }
        Insert: {
          accident_type?: string | null
          cause?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          measures?: string | null
          published_date?: string | null
          raw_text?: string | null
          search_tsv?: unknown
          source_org: string
          source_title: string
          source_url: string
          summary?: string | null
          tags?: string[] | null
          weather_related?: string | null
          work_type?: string | null
        }
        Update: {
          accident_type?: string | null
          cause?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          measures?: string | null
          published_date?: string | null
          raw_text?: string | null
          search_tsv?: unknown
          source_org?: string
          source_title?: string
          source_url?: string
          summary?: string | null
          tags?: string[] | null
          weather_related?: string | null
          work_type?: string | null
        }
        Relationships: []
      }
      ai_outputs: {
        Row: {
          countermeasures: Json
          generated_at: string
          generated_by: string | null
          hazard_behaviors: Json
          hazard_locations: Json
          id: string
          ky_entry_id: string
        }
        Insert: {
          countermeasures?: Json
          generated_at?: string
          generated_by?: string | null
          hazard_behaviors?: Json
          hazard_locations?: Json
          id?: string
          ky_entry_id: string
        }
        Update: {
          countermeasures?: Json
          generated_at?: string
          generated_by?: string | null
          hazard_behaviors?: Json
          hazard_locations?: Json
          id?: string
          ky_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_outputs_ky_entry_id_fkey"
            columns: ["ky_entry_id"]
            isOneToOne: false
            referencedRelation: "ky_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      app_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ky_ai_generations: {
        Row: {
          created_at: string
          id: string
          input: Json
          ky_entry_id: string | null
          output: Json
          project_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          input: Json
          ky_entry_id?: string | null
          output: Json
          project_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          input?: Json
          ky_entry_id?: string | null
          output?: Json
          project_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ky_ai_quality_logs: {
        Row: {
          ai_generation_id: string | null
          counts: Json | null
          created_at: string
          id: string
          ky_entry_id: string
          meta: Json | null
          per_field: Json | null
          rates: Json | null
          summary_json: Json
          target_field: string | null
          user_id: string | null
          version: number | null
        }
        Insert: {
          ai_generation_id?: string | null
          counts?: Json | null
          created_at?: string
          id?: string
          ky_entry_id: string
          meta?: Json | null
          per_field?: Json | null
          rates?: Json | null
          summary_json: Json
          target_field?: string | null
          user_id?: string | null
          version?: number | null
        }
        Update: {
          ai_generation_id?: string | null
          counts?: Json | null
          created_at?: string
          id?: string
          ky_entry_id?: string
          meta?: Json | null
          per_field?: Json | null
          rates?: Json | null
          summary_json?: Json
          target_field?: string | null
          user_id?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ky_ai_quality_logs_ai_generation_id_fkey"
            columns: ["ai_generation_id"]
            isOneToOne: false
            referencedRelation: "ky_ai_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ky_ai_quality_logs_ky_entry_id_fkey"
            columns: ["ky_entry_id"]
            isOneToOne: false
            referencedRelation: "ky_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_ai_results: {
        Row: {
          created_at: string
          id: string
          ky_daily_id: string
          model: string | null
          prompt: string | null
          result_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          ky_daily_id: string
          model?: string | null
          prompt?: string | null
          result_text: string
        }
        Update: {
          created_at?: string
          id?: string
          ky_daily_id?: string
          model?: string | null
          prompt?: string | null
          result_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_ai_results_ky_daily_id_fkey"
            columns: ["ky_daily_id"]
            isOneToOne: false
            referencedRelation: "ky_daily"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_approval_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ky_entry_id: string
          project_id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ky_entry_id: string
          project_id: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ky_entry_id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_approval_logs_ky_entry_id_fkey"
            columns: ["ky_entry_id"]
            isOneToOne: false
            referencedRelation: "ky_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ky_approval_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_approvals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          ky_daily_id: string
          status: string
          supervisor_comment: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          ky_daily_id: string
          status?: string
          supervisor_comment?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          ky_daily_id?: string
          status?: string
          supervisor_comment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_approvals_ky_daily_id_fkey"
            columns: ["ky_daily_id"]
            isOneToOne: true
            referencedRelation: "ky_daily"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_approvers: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_approvers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_daily: {
        Row: {
          contractor_name: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          partner_company_name: string | null
          precipitation_mm: number | null
          project_id: string
          temperature_c: number | null
          updated_at: string
          visitors_level: string | null
          weather: string | null
          wind_direction: string | null
          wind_mps: number | null
          work_date: string
        }
        Insert: {
          contractor_name?: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          partner_company_name?: string | null
          precipitation_mm?: number | null
          project_id: string
          temperature_c?: number | null
          updated_at?: string
          visitors_level?: string | null
          weather?: string | null
          wind_direction?: string | null
          wind_mps?: number | null
          work_date: string
        }
        Update: {
          contractor_name?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          partner_company_name?: string | null
          precipitation_mm?: number | null
          project_id?: string
          temperature_c?: number | null
          updated_at?: string
          visitors_level?: string | null
          weather?: string | null
          wind_direction?: string | null
          wind_mps?: number | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_daily_ai_risks: {
        Row: {
          created_at: string
          created_by: string | null
          exposure: number
          hazard: string
          id: string
          ky_daily_id: string
          ky_work_item_id: string | null
          likelihood: number
          measure: string
          rationale: string | null
          risk_score: number
          severity: number
          weather_factor: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          exposure: number
          hazard: string
          id?: string
          ky_daily_id: string
          ky_work_item_id?: string | null
          likelihood: number
          measure: string
          rationale?: string | null
          risk_score: number
          severity: number
          weather_factor?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          exposure?: number
          hazard?: string
          id?: string
          ky_daily_id?: string
          ky_work_item_id?: string | null
          likelihood?: number
          measure?: string
          rationale?: string | null
          risk_score?: number
          severity?: number
          weather_factor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ky_daily_ai_risks_ky_daily_id_fkey"
            columns: ["ky_daily_id"]
            isOneToOne: false
            referencedRelation: "ky_daily"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ky_daily_ai_risks_ky_work_item_id_fkey"
            columns: ["ky_work_item_id"]
            isOneToOne: false
            referencedRelation: "ky_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_delete_logs: {
        Row: {
          created_at: string
          id: string
          ky_entry_id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ky_entry_id: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ky_entry_id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_delete_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_entries: {
        Row: {
          ai_case_refs: Json | null
          ai_generated_at: string | null
          ai_supplement: string | null
          ai_supplement_hazards: string | null
          ai_supplement_measures: string | null
          ai_supplement_raw: string | null
          ai_supplement_third_party: string | null
          ai_supplement_work: string | null
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          countermeasures: string | null
          created_at: string
          created_by: string
          foreman_ra_1: string | null
          foreman_ra_2: string | null
          foreman_ra_3: string | null
          hazards: string | null
          heavy_machinery: boolean
          id: string
          is_ai_generated: boolean
          is_approved: boolean
          location: string | null
          night_work: boolean
          notes: string | null
          partner_company_id: string | null
          partner_company_name: string
          precipitation_mm: number | null
          project_id: string
          slope_work: boolean
          status: string
          subcontractor_id: string | null
          subcontractor_name: string | null
          temperature_text: string | null
          third_party: boolean
          third_party_situation: string | null
          title: string | null
          traffic_control: boolean
          unapproved_at: string | null
          unapproved_by: string | null
          updated_at: string | null
          user_id: string | null
          weather: string | null
          wind_direction: string | null
          wind_speed_text: string | null
          work_date: string
          work_detail: string | null
          workers: number | null
        }
        Insert: {
          ai_case_refs?: Json | null
          ai_generated_at?: string | null
          ai_supplement?: string | null
          ai_supplement_hazards?: string | null
          ai_supplement_measures?: string | null
          ai_supplement_raw?: string | null
          ai_supplement_third_party?: string | null
          ai_supplement_work?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          countermeasures?: string | null
          created_at?: string
          created_by?: string
          foreman_ra_1?: string | null
          foreman_ra_2?: string | null
          foreman_ra_3?: string | null
          hazards?: string | null
          heavy_machinery?: boolean
          id?: string
          is_ai_generated?: boolean
          is_approved?: boolean
          location?: string | null
          night_work?: boolean
          notes?: string | null
          partner_company_id?: string | null
          partner_company_name: string
          precipitation_mm?: number | null
          project_id: string
          slope_work?: boolean
          status?: string
          subcontractor_id?: string | null
          subcontractor_name?: string | null
          temperature_text?: string | null
          third_party?: boolean
          third_party_situation?: string | null
          title?: string | null
          traffic_control?: boolean
          unapproved_at?: string | null
          unapproved_by?: string | null
          updated_at?: string | null
          user_id?: string | null
          weather?: string | null
          wind_direction?: string | null
          wind_speed_text?: string | null
          work_date: string
          work_detail?: string | null
          workers?: number | null
        }
        Update: {
          ai_case_refs?: Json | null
          ai_generated_at?: string | null
          ai_supplement?: string | null
          ai_supplement_hazards?: string | null
          ai_supplement_measures?: string | null
          ai_supplement_raw?: string | null
          ai_supplement_third_party?: string | null
          ai_supplement_work?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          countermeasures?: string | null
          created_at?: string
          created_by?: string
          foreman_ra_1?: string | null
          foreman_ra_2?: string | null
          foreman_ra_3?: string | null
          hazards?: string | null
          heavy_machinery?: boolean
          id?: string
          is_ai_generated?: boolean
          is_approved?: boolean
          location?: string | null
          night_work?: boolean
          notes?: string | null
          partner_company_id?: string | null
          partner_company_name?: string
          precipitation_mm?: number | null
          project_id?: string
          slope_work?: boolean
          status?: string
          subcontractor_id?: string | null
          subcontractor_name?: string | null
          temperature_text?: string | null
          third_party?: boolean
          third_party_situation?: string | null
          title?: string | null
          traffic_control?: boolean
          unapproved_at?: string | null
          unapproved_by?: string | null
          updated_at?: string | null
          user_id?: string | null
          weather?: string | null
          wind_direction?: string | null
          wind_speed_text?: string | null
          work_date?: string
          work_detail?: string | null
          workers?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ky_entries_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "partner_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ky_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ky_entries_subcontractor_id_fkey"
            columns: ["subcontractor_id"]
            isOneToOne: false
            referencedRelation: "subcontractors"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_items: {
        Row: {
          ai_generated_at: string | null
          countermeasures_adopted: string | null
          countermeasures_ai: Json
          countermeasures_human: string
          created_at: string
          hazards_adopted: string | null
          hazards_ai: Json
          hazards_human: string
          id: string
          ky_daily_id: string | null
          ky_entry_id: string
          sort_no: number
          updated_at: string
          work_detail_human: string
        }
        Insert: {
          ai_generated_at?: string | null
          countermeasures_adopted?: string | null
          countermeasures_ai?: Json
          countermeasures_human?: string
          created_at?: string
          hazards_adopted?: string | null
          hazards_ai?: Json
          hazards_human?: string
          id?: string
          ky_daily_id?: string | null
          ky_entry_id: string
          sort_no?: number
          updated_at?: string
          work_detail_human?: string
        }
        Update: {
          ai_generated_at?: string | null
          countermeasures_adopted?: string | null
          countermeasures_ai?: Json
          countermeasures_human?: string
          created_at?: string
          hazards_adopted?: string | null
          hazards_ai?: Json
          hazards_human?: string
          id?: string
          ky_daily_id?: string | null
          ky_entry_id?: string
          sort_no?: number
          updated_at?: string
          work_detail_human?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_items_ky_daily_id_fkey"
            columns: ["ky_daily_id"]
            isOneToOne: false
            referencedRelation: "ky_daily"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ky_items_ky_entry_id_fkey"
            columns: ["ky_entry_id"]
            isOneToOne: false
            referencedRelation: "ky_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_partner_candidates: {
        Row: {
          company_name: string
          company_name_norm: string
          id: number
          last_used_at: string
          project_id: string | null
          scope: string
          used_count: number
        }
        Insert: {
          company_name: string
          company_name_norm: string
          id?: number
          last_used_at?: string
          project_id?: string | null
          scope: string
          used_count?: number
        }
        Update: {
          company_name?: string
          company_name_norm?: string
          id?: number
          last_used_at?: string
          project_id?: string | null
          scope?: string
          used_count?: number
        }
        Relationships: []
      }
      ky_photos: {
        Row: {
          created_at: string
          created_by: string
          id: string
          ky_entry_id: string
          photo_type: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          ky_entry_id: string
          photo_type: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          ky_entry_id?: string
          photo_type?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_photos_ky_entry_id_fkey"
            columns: ["ky_entry_id"]
            isOneToOne: false
            referencedRelation: "ky_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ky_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          template_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
          template_text: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          template_text?: string
        }
        Relationships: []
      }
      ky_work_items: {
        Row: {
          hazards: string | null
          id: string
          ky_daily_id: string
          leader_name: string | null
          measures: string | null
          seq: number
          work_name: string
          work_type: string
        }
        Insert: {
          hazards?: string | null
          id?: string
          ky_daily_id: string
          leader_name?: string | null
          measures?: string | null
          seq: number
          work_name: string
          work_type: string
        }
        Update: {
          hazards?: string | null
          id?: string
          ky_daily_id?: string
          leader_name?: string | null
          measures?: string | null
          seq?: number
          work_name?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ky_work_items_ky_daily_id_fkey"
            columns: ["ky_daily_id"]
            isOneToOne: false
            referencedRelation: "ky_daily"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_companies: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          member_role: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_role: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_role?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_partner_companies: {
        Row: {
          created_at: string
          id: string
          partner_company_id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          partner_company_id: string
          project_id: string
        }
        Update: {
          created_at?: string
          id?: string
          partner_company_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_partner_companies_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "partner_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_partner_companies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_subcontractors: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          note: string | null
          project_id: string
          subcontractor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          note?: string | null
          project_id: string
          subcontractor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          note?: string | null
          project_id?: string
          subcontractor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_subcontractors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_subcontractors_subcontractor_id_fkey"
            columns: ["subcontractor_id"]
            isOneToOne: false
            referencedRelation: "subcontractors"
            referencedColumns: ["id"]
          },
        ]
      }
      project_weather_current: {
        Row: {
          observed_at: string | null
          precipitation_mm: number | null
          project_id: string
          temperature_text: string | null
          updated_at: string
          weather: string | null
          weathercode: number | null
          wind_direction: string | null
          wind_speed_text: string | null
        }
        Insert: {
          observed_at?: string | null
          precipitation_mm?: number | null
          project_id: string
          temperature_text?: string | null
          updated_at?: string
          weather?: string | null
          weathercode?: number | null
          wind_direction?: string | null
          wind_speed_text?: string | null
        }
        Update: {
          observed_at?: string | null
          precipitation_mm?: number | null
          project_id?: string
          temperature_text?: string | null
          updated_at?: string
          weather?: string | null
          weathercode?: number | null
          wind_direction?: string | null
          wind_speed_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_weather_current_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_weather_logs: {
        Row: {
          created_at: string
          id: string
          observed_at: string
          precipitation_mm: number | null
          project_id: string
          source: string
          temperature_text: string | null
          weather: string | null
          wind_direction: string | null
          wind_speed_text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          observed_at?: string
          precipitation_mm?: number | null
          project_id: string
          source?: string
          temperature_text?: string | null
          weather?: string | null
          wind_direction?: string | null
          wind_speed_text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          observed_at?: string
          precipitation_mm?: number | null
          project_id?: string
          source?: string
          temperature_text?: string | null
          weather?: string | null
          wind_direction?: string | null
          wind_speed_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_weather_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          lat: number | null
          lon: number | null
          name: string
          site_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number | null
          lon?: number | null
          name: string
          site_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number | null
          lon?: number | null
          name?: string
          site_name?: string | null
        }
        Relationships: []
      }
      safety_cases: {
        Row: {
          content_summary: string | null
          content_text: string
          embedding: string | null
          fetched_at: string
          id: string
          source: string
          tags: string[]
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          content_summary?: string | null
          content_text: string
          embedding?: string | null
          fetched_at?: string
          id?: string
          source?: string
          tags?: string[]
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          content_summary?: string | null
          content_text?: string
          embedding?: string | null
          fetched_at?: string
          id?: string
          source?: string
          tags?: string[]
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      subcontractors: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          name_kana: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          name_kana?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          name_kana?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      weather_observations: {
        Row: {
          id: string
          lat: number
          lon: number
          observed_at: string
          precipitation_mm: number | null
          temperature_text: string | null
          weather: string | null
          weathercode: number | null
          wind_direction: string | null
          wind_speed_text: string | null
        }
        Insert: {
          id?: string
          lat: number
          lon: number
          observed_at: string
          precipitation_mm?: number | null
          temperature_text?: string | null
          weather?: string | null
          weathercode?: number | null
          wind_direction?: string | null
          wind_speed_text?: string | null
        }
        Update: {
          id?: string
          lat?: number
          lon?: number
          observed_at?: string
          precipitation_mm?: number | null
          temperature_text?: string | null
          weather?: string | null
          weathercode?: number | null
          wind_direction?: string | null
          wind_speed_text?: string | null
        }
        Relationships: []
      }
      weather_snapshots: {
        Row: {
          created_at: string
          id: string
          observed_at: string
          precipitation_mm: number | null
          project_id: string
          raw: Json | null
          source: string
          temperature_c: number | null
          wind_direction: string | null
          wind_speed_ms: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          observed_at: string
          precipitation_mm?: number | null
          project_id: string
          raw?: Json | null
          source?: string
          temperature_c?: number | null
          wind_direction?: string | null
          wind_speed_ms?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          observed_at?: string
          precipitation_mm?: number | null
          project_id?: string
          raw?: Json | null
          source?: string
          temperature_c?: number | null
          wind_direction?: string | null
          wind_speed_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weather_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_app_admin: { Args: { uid: string }; Returns: boolean }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      ky_delete_entries_bulk: {
        Args: { p_ky_entry_ids: string[]; p_project_id: string }
        Returns: undefined
      }
      ky_delete_entry: {
        Args: { p_ky_entry_id: string; p_project_id: string }
        Returns: undefined
      }
      ky_set_approved: {
        Args: {
          p_is_approved: boolean
          p_ky_entry_id: string
          p_project_id: string
        }
        Returns: undefined
      }
      ky_set_approved_bulk: {
        Args: {
          p_is_approved: boolean
          p_ky_entry_ids: string[]
          p_project_id: string
        }
        Returns: undefined
      }
      match_safety_cases: {
        Args: {
          match_count?: number
          query_embedding: string
          source_filter?: string
        }
        Returns: {
          content_summary: string
          distance: number
          id: string
          tags: string[]
          title: string
          url: string
        }[]
      }
      normalize_company_name_db: { Args: { input: string }; Returns: string }
    }
    Enums: {
      user_role: "admin" | "supervisor" | "worker" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_role: ["admin", "supervisor", "worker", "viewer"],
    },
  },
} as const
