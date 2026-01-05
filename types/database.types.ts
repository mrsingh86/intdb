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
      action_tasks: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          assigned_to_name: string | null
          category: string
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          created_at: string | null
          description: string | null
          document_lifecycle_id: string | null
          due_date: string | null
          id: string
          is_recurring: boolean | null
          notification_id: string | null
          priority: string
          priority_factors: Json | null
          priority_score: number
          recurrence_pattern: Json | null
          shipment_id: string | null
          stakeholder_id: string | null
          status: string
          status_notes: string | null
          task_number: number
          template_code: string | null
          template_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          category: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string | null
          description?: string | null
          document_lifecycle_id?: string | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean | null
          notification_id?: string | null
          priority?: string
          priority_factors?: Json | null
          priority_score?: number
          recurrence_pattern?: Json | null
          shipment_id?: string | null
          stakeholder_id?: string | null
          status?: string
          status_notes?: string | null
          task_number?: number
          template_code?: string | null
          template_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string | null
          description?: string | null
          document_lifecycle_id?: string | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean | null
          notification_id?: string | null
          priority?: string
          priority_factors?: Json | null
          priority_score?: number
          recurrence_pattern?: Json | null
          shipment_id?: string | null
          stakeholder_id?: string | null
          status?: string
          status_notes?: string | null
          task_number?: number
          template_code?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_tasks_document_lifecycle_id_fkey"
            columns: ["document_lifecycle_id"]
            isOneToOne: false
            referencedRelation: "document_lifecycle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_stakeholder_id_fkey"
            columns: ["stakeholder_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_configs: {
        Row: {
          accuracy_rate: number | null
          avg_confidence: number | null
          correct_predictions: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          max_tokens: number | null
          model_name: string
          model_type: string
          model_version: string
          system_prompt: string | null
          temperature: number | null
          total_predictions: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_confidence?: number | null
          correct_predictions?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          max_tokens?: number | null
          model_name: string
          model_type: string
          model_version: string
          system_prompt?: string | null
          temperature?: number | null
          total_predictions?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_confidence?: number | null
          correct_predictions?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          max_tokens?: number | null
          model_name?: string
          model_type?: string
          model_version?: string
          system_prompt?: string | null
          temperature?: number | null
          total_predictions?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      archival_policies: {
        Row: {
          archive_action: string
          archive_storage_path: string | null
          created_at: string | null
          enabled: boolean | null
          entity_type: string
          id: string
          min_shipment_age_days: number | null
          policy_name: string
          require_manual_approval: boolean | null
          retention_condition: string | null
          retention_days: number
          updated_at: string | null
        }
        Insert: {
          archive_action: string
          archive_storage_path?: string | null
          created_at?: string | null
          enabled?: boolean | null
          entity_type: string
          id?: string
          min_shipment_age_days?: number | null
          policy_name: string
          require_manual_approval?: boolean | null
          retention_condition?: string | null
          retention_days: number
          updated_at?: string | null
        }
        Update: {
          archive_action?: string
          archive_storage_path?: string | null
          created_at?: string | null
          enabled?: boolean | null
          entity_type?: string
          id?: string
          min_shipment_age_days?: number | null
          policy_name?: string
          require_manual_approval?: boolean | null
          retention_condition?: string | null
          retention_days?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      booking_revisions: {
        Row: {
          booking_number: string
          changed_fields: Json | null
          consignee_name: string | null
          container_type: string | null
          created_at: string | null
          eta: string | null
          etd: string | null
          id: string
          port_of_discharge: string | null
          port_of_loading: string | null
          revision_number: number
          revision_type: string | null
          shipper_name: string | null
          source_email_id: string | null
          vessel_name: string | null
          voyage_number: string | null
        }
        Insert: {
          booking_number: string
          changed_fields?: Json | null
          consignee_name?: string | null
          container_type?: string | null
          created_at?: string | null
          eta?: string | null
          etd?: string | null
          id?: string
          port_of_discharge?: string | null
          port_of_loading?: string | null
          revision_number: number
          revision_type?: string | null
          shipper_name?: string | null
          source_email_id?: string | null
          vessel_name?: string | null
          voyage_number?: string | null
        }
        Update: {
          booking_number?: string
          changed_fields?: Json | null
          consignee_name?: string | null
          container_type?: string | null
          created_at?: string | null
          eta?: string | null
          etd?: string | null
          id?: string
          port_of_discharge?: string | null
          port_of_loading?: string | null
          revision_number?: number
          revision_type?: string | null
          shipper_name?: string | null
          source_email_id?: string | null
          vessel_name?: string | null
          voyage_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_revisions_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_configs: {
        Row: {
          bl_number_regex: string | null
          booking_number_regex: string | null
          carrier_name: string
          container_number_prefix: string[] | null
          created_at: string | null
          default_confidence_adjustment: number | null
          email_sender_patterns: string[] | null
          email_subject_patterns: string[] | null
          enabled: boolean | null
          id: string
          requires_true_sender_extraction: boolean | null
          updated_at: string | null
        }
        Insert: {
          bl_number_regex?: string | null
          booking_number_regex?: string | null
          carrier_name: string
          container_number_prefix?: string[] | null
          created_at?: string | null
          default_confidence_adjustment?: number | null
          email_sender_patterns?: string[] | null
          email_subject_patterns?: string[] | null
          enabled?: boolean | null
          id: string
          requires_true_sender_extraction?: boolean | null
          updated_at?: string | null
        }
        Update: {
          bl_number_regex?: string | null
          booking_number_regex?: string | null
          carrier_name?: string
          container_number_prefix?: string[] | null
          created_at?: string | null
          default_confidence_adjustment?: number | null
          email_sender_patterns?: string[] | null
          email_subject_patterns?: string[] | null
          enabled?: boolean | null
          id?: string
          requires_true_sender_extraction?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      carriers: {
        Row: {
          carrier_code: string
          carrier_name: string
          created_at: string | null
          email_domains: string[] | null
          id: string
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          carrier_code: string
          carrier_name: string
          created_at?: string | null
          email_domains?: string[] | null
          id?: string
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          carrier_code?: string
          carrier_name?: string
          created_at?: string | null
          email_domains?: string[] | null
          id?: string
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      classification_feedback: {
        Row: {
          classification_explanation: string | null
          corrected_classification: string | null
          created_at: string | null
          email_id: string
          feedback_type: string
          id: string
          is_processed: boolean | null
          original_classification: string | null
          pattern_description: string | null
          pattern_examples: string[] | null
          processed_at: string | null
          processing_status: string | null
          submitted_at: string
          submitted_by: string
          updated_at: string | null
        }
        Insert: {
          classification_explanation?: string | null
          corrected_classification?: string | null
          created_at?: string | null
          email_id: string
          feedback_type: string
          id?: string
          is_processed?: boolean | null
          original_classification?: string | null
          pattern_description?: string | null
          pattern_examples?: string[] | null
          processed_at?: string | null
          processing_status?: string | null
          submitted_at?: string
          submitted_by?: string
          updated_at?: string | null
        }
        Update: {
          classification_explanation?: string | null
          corrected_classification?: string | null
          created_at?: string | null
          email_id?: string
          feedback_type?: string
          id?: string
          is_processed?: boolean | null
          original_classification?: string | null
          pattern_description?: string | null
          pattern_examples?: string[] | null
          processed_at?: string | null
          processing_status?: string | null
          submitted_at?: string
          submitted_by?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classification_feedback_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_rules: {
        Row: {
          affected_email_count: number | null
          approved_at: string | null
          approved_by: string | null
          body_keywords: string[] | null
          confidence_boost: number | null
          created_at: string | null
          failed_applications: number | null
          id: string
          is_active: boolean | null
          learned_from_count: number | null
          needs_approval: boolean | null
          rejection_reason: string | null
          required_entities: string[] | null
          rule_name: string
          rule_type: string | null
          sender_patterns: string[] | null
          source_feedback_ids: string[] | null
          subject_patterns: string[] | null
          successful_applications: number | null
          target_document_type: string
          updated_at: string | null
        }
        Insert: {
          affected_email_count?: number | null
          approved_at?: string | null
          approved_by?: string | null
          body_keywords?: string[] | null
          confidence_boost?: number | null
          created_at?: string | null
          failed_applications?: number | null
          id?: string
          is_active?: boolean | null
          learned_from_count?: number | null
          needs_approval?: boolean | null
          rejection_reason?: string | null
          required_entities?: string[] | null
          rule_name: string
          rule_type?: string | null
          sender_patterns?: string[] | null
          source_feedback_ids?: string[] | null
          subject_patterns?: string[] | null
          successful_applications?: number | null
          target_document_type: string
          updated_at?: string | null
        }
        Update: {
          affected_email_count?: number | null
          approved_at?: string | null
          approved_by?: string | null
          body_keywords?: string[] | null
          confidence_boost?: number | null
          created_at?: string | null
          failed_applications?: number | null
          id?: string
          is_active?: boolean | null
          learned_from_count?: number | null
          needs_approval?: boolean | null
          rejection_reason?: string | null
          required_entities?: string[] | null
          rule_name?: string
          rule_type?: string | null
          sender_patterns?: string[] | null
          source_feedback_ids?: string[] | null
          subject_patterns?: string[] | null
          successful_applications?: number | null
          target_document_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      communication_log: {
        Row: {
          ai_draft_prompt: string | null
          ai_drafted: boolean | null
          ai_model_used: string | null
          bcc_emails: string[] | null
          body_html: string | null
          body_text: string
          cc_emails: string[] | null
          communication_type: string
          created_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          human_edited: boolean | null
          id: string
          notification_id: string | null
          response_email_id: string | null
          response_received: boolean | null
          response_received_at: string | null
          sent_at: string | null
          sent_by: string | null
          sent_by_name: string | null
          shipment_id: string | null
          status: string
          status_details: string | null
          subject: string
          task_id: string | null
          to_emails: string[]
          updated_at: string | null
        }
        Insert: {
          ai_draft_prompt?: string | null
          ai_drafted?: boolean | null
          ai_model_used?: string | null
          bcc_emails?: string[] | null
          body_html?: string | null
          body_text: string
          cc_emails?: string[] | null
          communication_type?: string
          created_at?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          human_edited?: boolean | null
          id?: string
          notification_id?: string | null
          response_email_id?: string | null
          response_received?: boolean | null
          response_received_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_by_name?: string | null
          shipment_id?: string | null
          status?: string
          status_details?: string | null
          subject: string
          task_id?: string | null
          to_emails: string[]
          updated_at?: string | null
        }
        Update: {
          ai_draft_prompt?: string | null
          ai_drafted?: boolean | null
          ai_model_used?: string | null
          bcc_emails?: string[] | null
          body_html?: string | null
          body_text?: string
          cc_emails?: string[] | null
          communication_type?: string
          created_at?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          human_edited?: boolean | null
          id?: string
          notification_id?: string | null
          response_email_id?: string | null
          response_received?: boolean | null
          response_received_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_by_name?: string | null
          shipment_id?: string | null
          status?: string
          status_details?: string | null
          subject?: string
          task_id?: string | null
          to_emails?: string[]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_log_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_response_email_id_fkey"
            columns: ["response_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_persons: {
        Row: {
          average_response_time_hours: number | null
          best_time_to_contact: string | null
          created_at: string | null
          customer_id: string | null
          department: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          job_title: string | null
          language_preference: string | null
          last_contacted_at: string | null
          mobile: string | null
          party_id: string | null
          phone: string | null
          preferred_channel: string | null
          total_communications: number | null
          updated_at: string | null
          vendor_id: string | null
          whatsapp: string | null
        }
        Insert: {
          average_response_time_hours?: number | null
          best_time_to_contact?: string | null
          created_at?: string | null
          customer_id?: string | null
          department?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          job_title?: string | null
          language_preference?: string | null
          last_contacted_at?: string | null
          mobile?: string | null
          party_id?: string | null
          phone?: string | null
          preferred_channel?: string | null
          total_communications?: number | null
          updated_at?: string | null
          vendor_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          average_response_time_hours?: number | null
          best_time_to_contact?: string | null
          created_at?: string | null
          customer_id?: string | null
          department?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          job_title?: string | null
          language_preference?: string | null
          last_contacted_at?: string | null
          mobile?: string | null
          party_id?: string | null
          phone?: string | null
          preferred_channel?: string | null
          total_communications?: number | null
          updated_at?: string | null
          vendor_id?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_persons_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_persons_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_intelligence: {
        Row: {
          confidence_score: number
          created_at: string | null
          customer_id: string
          detected_at: string | null
          evidence_count: number | null
          id: string
          is_active: boolean | null
          learned_from: string
          model_name: string | null
          preference_category: string
          preference_data: Json
          updated_at: string | null
          verified_by_human: boolean | null
        }
        Insert: {
          confidence_score: number
          created_at?: string | null
          customer_id: string
          detected_at?: string | null
          evidence_count?: number | null
          id?: string
          is_active?: boolean | null
          learned_from: string
          model_name?: string | null
          preference_category: string
          preference_data: Json
          updated_at?: string | null
          verified_by_human?: boolean | null
        }
        Update: {
          confidence_score?: number
          created_at?: string | null
          customer_id?: string
          detected_at?: string | null
          evidence_count?: number | null
          id?: string
          is_active?: boolean | null
          learned_from?: string
          model_name?: string | null
          preference_category?: string
          preference_data?: Json
          updated_at?: string | null
          verified_by_human?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_intelligence_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_party_relationships: {
        Row: {
          average_shipment_frequency_days: number | null
          created_at: string | null
          customer_id: string
          first_used_at: string | null
          id: string
          last_used_at: string | null
          party_id: string
          relationship_type: string
          times_used_together: number | null
          typical_commodity: string | null
          typical_trade_lane: string | null
          updated_at: string | null
        }
        Insert: {
          average_shipment_frequency_days?: number | null
          created_at?: string | null
          customer_id: string
          first_used_at?: string | null
          id?: string
          last_used_at?: string | null
          party_id: string
          relationship_type: string
          times_used_together?: number | null
          typical_commodity?: string | null
          typical_trade_lane?: string | null
          updated_at?: string | null
        }
        Update: {
          average_shipment_frequency_days?: number | null
          created_at?: string | null
          customer_id?: string
          first_used_at?: string | null
          id?: string
          last_used_at?: string | null
          party_id?: string
          relationship_type?: string
          times_used_together?: number | null
          typical_commodity?: string | null
          typical_trade_lane?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_party_relationships_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          average_shipment_value: number | null
          bank_account_number: string | null
          bank_ifsc_code: string | null
          bank_name: string | null
          communication_style: Json | null
          company_address: string | null
          company_city: string | null
          company_country: string | null
          company_postal_code: string | null
          company_registration_number: string | null
          company_state: string | null
          company_website: string | null
          created_at: string | null
          created_by: string | null
          created_from_email_id: string | null
          credit_days: number | null
          credit_limit: number | null
          customer_code: string
          customer_legal_name: string | null
          customer_name: string
          customer_preferences: Json | null
          customer_segment: string | null
          customer_type: string
          id: string
          iec_code: string | null
          industry: string | null
          on_time_payment_rate: number | null
          payment_terms: string | null
          preferred_currency: string | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          risk_level: string | null
          status: string | null
          tax_id: string | null
          total_revenue: number | null
          total_shipments: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          average_shipment_value?: number | null
          bank_account_number?: string | null
          bank_ifsc_code?: string | null
          bank_name?: string | null
          communication_style?: Json | null
          company_address?: string | null
          company_city?: string | null
          company_country?: string | null
          company_postal_code?: string | null
          company_registration_number?: string | null
          company_state?: string | null
          company_website?: string | null
          created_at?: string | null
          created_by?: string | null
          created_from_email_id?: string | null
          credit_days?: number | null
          credit_limit?: number | null
          customer_code: string
          customer_legal_name?: string | null
          customer_name: string
          customer_preferences?: Json | null
          customer_segment?: string | null
          customer_type: string
          id?: string
          iec_code?: string | null
          industry?: string | null
          on_time_payment_rate?: number | null
          payment_terms?: string | null
          preferred_currency?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          risk_level?: string | null
          status?: string | null
          tax_id?: string | null
          total_revenue?: number | null
          total_shipments?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          average_shipment_value?: number | null
          bank_account_number?: string | null
          bank_ifsc_code?: string | null
          bank_name?: string | null
          communication_style?: Json | null
          company_address?: string | null
          company_city?: string | null
          company_country?: string | null
          company_postal_code?: string | null
          company_registration_number?: string | null
          company_state?: string | null
          company_website?: string | null
          created_at?: string | null
          created_by?: string | null
          created_from_email_id?: string | null
          credit_days?: number | null
          credit_limit?: number | null
          customer_code?: string
          customer_legal_name?: string | null
          customer_name?: string
          customer_preferences?: Json | null
          customer_segment?: string | null
          customer_type?: string
          id?: string
          iec_code?: string | null
          industry?: string | null
          on_time_payment_rate?: number | null
          payment_terms?: string | null
          preferred_currency?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          risk_level?: string | null
          status?: string | null
          tax_id?: string | null
          total_revenue?: number | null
          total_shipments?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_from_email_id_fkey"
            columns: ["created_from_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      data_lifecycle_log: {
        Row: {
          action: string
          action_reason: string | null
          data_size_bytes: number | null
          entity_id: string
          entity_type: string
          error_message: string | null
          executed_at: string | null
          executed_by: string | null
          id: string
          records_affected: number | null
          status: string | null
        }
        Insert: {
          action: string
          action_reason?: string | null
          data_size_bytes?: number | null
          entity_id: string
          entity_type: string
          error_message?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          records_affected?: number | null
          status?: string | null
        }
        Update: {
          action?: string
          action_reason?: string | null
          data_size_bytes?: number | null
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          records_affected?: number | null
          status?: string | null
        }
        Relationships: []
      }
      document_acknowledgment_patterns: {
        Row: {
          acknowledgment_keywords: string[]
          created_at: string | null
          default_due_hours: number | null
          document_type: string
          expected_responder_party_type: string | null
          id: string
          is_active: boolean | null
          rejection_keywords: string[] | null
        }
        Insert: {
          acknowledgment_keywords: string[]
          created_at?: string | null
          default_due_hours?: number | null
          document_type: string
          expected_responder_party_type?: string | null
          id?: string
          is_active?: boolean | null
          rejection_keywords?: string[] | null
        }
        Update: {
          acknowledgment_keywords?: string[]
          created_at?: string | null
          default_due_hours?: number | null
          document_type?: string
          expected_responder_party_type?: string | null
          id?: string
          is_active?: boolean | null
          rejection_keywords?: string[] | null
        }
        Relationships: []
      }
      document_authority_rules: {
        Row: {
          authority_level: number
          can_override_from: string[] | null
          created_at: string | null
          document_type: string
          entity_type: string
          extraction_prompt_key: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
          validation_rules: Json | null
        }
        Insert: {
          authority_level?: number
          can_override_from?: string[] | null
          created_at?: string | null
          document_type: string
          entity_type: string
          extraction_prompt_key?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Update: {
          authority_level?: number
          can_override_from?: string[] | null
          created_at?: string | null
          document_type?: string
          entity_type?: string
          extraction_prompt_key?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Relationships: []
      }
      document_classifications: {
        Row: {
          attachment_id: string | null
          classification_reason: string | null
          classified_at: string | null
          confidence_score: number
          corrected_type: string | null
          created_at: string | null
          document_direction: string | null
          document_type: string
          email_id: string | null
          feedback_at: string | null
          feedback_by: string | null
          id: string
          is_correct: boolean | null
          is_manual_review: boolean | null
          matched_patterns: Json | null
          model_name: string
          model_version: string
          receiver_party_type: string | null
          requires_approval_from: string | null
          review_explanation: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision_number: number | null
          revision_type: string | null
          sender_party_type: string | null
          workflow_state: string | null
        }
        Insert: {
          attachment_id?: string | null
          classification_reason?: string | null
          classified_at?: string | null
          confidence_score: number
          corrected_type?: string | null
          created_at?: string | null
          document_direction?: string | null
          document_type: string
          email_id?: string | null
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          is_correct?: boolean | null
          is_manual_review?: boolean | null
          matched_patterns?: Json | null
          model_name: string
          model_version: string
          receiver_party_type?: string | null
          requires_approval_from?: string | null
          review_explanation?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision_number?: number | null
          revision_type?: string | null
          sender_party_type?: string | null
          workflow_state?: string | null
        }
        Update: {
          attachment_id?: string | null
          classification_reason?: string | null
          classified_at?: string | null
          confidence_score?: number
          corrected_type?: string | null
          created_at?: string | null
          document_direction?: string | null
          document_type?: string
          email_id?: string | null
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          is_correct?: boolean | null
          is_manual_review?: boolean | null
          matched_patterns?: Json | null
          model_name?: string
          model_version?: string
          receiver_party_type?: string | null
          requires_approval_from?: string | null
          review_explanation?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision_number?: number | null
          revision_type?: string | null
          sender_party_type?: string | null
          workflow_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_classifications_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "raw_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_classifications_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      document_comparison_fields: {
        Row: {
          comparison_type: string
          created_at: string | null
          field_display_name: string | null
          field_name: string
          id: string
          is_active: boolean | null
          severity: string
          source_document_type: string
          target_document_type: string
        }
        Insert: {
          comparison_type?: string
          created_at?: string | null
          field_display_name?: string | null
          field_name: string
          id?: string
          is_active?: boolean | null
          severity?: string
          source_document_type: string
          target_document_type: string
        }
        Update: {
          comparison_type?: string
          created_at?: string | null
          field_display_name?: string | null
          field_name?: string
          id?: string
          is_active?: boolean | null
          severity?: string
          source_document_type?: string
          target_document_type?: string
        }
        Relationships: []
      }
      document_comparisons: {
        Row: {
          compared_at: string | null
          comparison_status: string
          created_at: string | null
          critical_discrepancies: number | null
          discrepancy_count: number | null
          field_comparisons: Json | null
          id: string
          is_resolved: boolean | null
          matching_fields: number | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          source_document_type: string
          source_revision_id: string | null
          target_document_type: string
          target_revision_id: string | null
          total_fields_compared: number | null
          updated_at: string | null
        }
        Insert: {
          compared_at?: string | null
          comparison_status: string
          created_at?: string | null
          critical_discrepancies?: number | null
          discrepancy_count?: number | null
          field_comparisons?: Json | null
          id?: string
          is_resolved?: boolean | null
          matching_fields?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id: string
          source_document_type: string
          source_revision_id?: string | null
          target_document_type: string
          target_revision_id?: string | null
          total_fields_compared?: number | null
          updated_at?: string | null
        }
        Update: {
          compared_at?: string | null
          comparison_status?: string
          created_at?: string | null
          critical_discrepancies?: number | null
          discrepancy_count?: number | null
          field_comparisons?: Json | null
          id?: string
          is_resolved?: boolean | null
          matching_fields?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id?: string
          source_document_type?: string
          source_revision_id?: string | null
          target_document_type?: string
          target_revision_id?: string | null
          total_fields_compared?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_comparisons_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comparisons_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comparisons_source_revision_id_fkey"
            columns: ["source_revision_id"]
            isOneToOne: false
            referencedRelation: "document_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comparisons_target_revision_id_fkey"
            columns: ["target_revision_id"]
            isOneToOne: false
            referencedRelation: "document_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_flow_rules: {
        Row: {
          approval_party: string | null
          created_at: string | null
          default_receiver_party: string | null
          default_workflow_state: string | null
          document_type: string
          id: string
          is_active: boolean | null
          next_action: string | null
          notes: string | null
          requires_approval: boolean | null
          sender_party_type: string
        }
        Insert: {
          approval_party?: string | null
          created_at?: string | null
          default_receiver_party?: string | null
          default_workflow_state?: string | null
          document_type: string
          id?: string
          is_active?: boolean | null
          next_action?: string | null
          notes?: string | null
          requires_approval?: boolean | null
          sender_party_type: string
        }
        Update: {
          approval_party?: string | null
          created_at?: string | null
          default_receiver_party?: string | null
          default_workflow_state?: string | null
          document_type?: string
          id?: string
          is_active?: boolean | null
          next_action?: string | null
          notes?: string | null
          requires_approval?: boolean | null
          sender_party_type?: string
        }
        Relationships: []
      }
      document_lifecycle: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by_party_id: string | null
          acknowledgment_due_date: string | null
          acknowledgment_email_id: string | null
          acknowledgment_method: string | null
          acknowledgment_required: boolean | null
          approved_at: string | null
          created_at: string | null
          current_revision_id: string | null
          document_type: string
          due_date: string | null
          id: string
          lifecycle_status: string
          missing_fields: string[] | null
          quality_score: number | null
          received_at: string | null
          rejection_reason: string | null
          revision_count: number | null
          sent_at: string | null
          shipment_id: string
          status_history: Json | null
          updated_at: string | null
          validation_errors: string[] | null
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by_party_id?: string | null
          acknowledgment_due_date?: string | null
          acknowledgment_email_id?: string | null
          acknowledgment_method?: string | null
          acknowledgment_required?: boolean | null
          approved_at?: string | null
          created_at?: string | null
          current_revision_id?: string | null
          document_type: string
          due_date?: string | null
          id?: string
          lifecycle_status?: string
          missing_fields?: string[] | null
          quality_score?: number | null
          received_at?: string | null
          rejection_reason?: string | null
          revision_count?: number | null
          sent_at?: string | null
          shipment_id: string
          status_history?: Json | null
          updated_at?: string | null
          validation_errors?: string[] | null
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by_party_id?: string | null
          acknowledgment_due_date?: string | null
          acknowledgment_email_id?: string | null
          acknowledgment_method?: string | null
          acknowledgment_required?: boolean | null
          approved_at?: string | null
          created_at?: string | null
          current_revision_id?: string | null
          document_type?: string
          due_date?: string | null
          id?: string
          lifecycle_status?: string
          missing_fields?: string[] | null
          quality_score?: number | null
          received_at?: string | null
          rejection_reason?: string | null
          revision_count?: number | null
          sent_at?: string | null
          shipment_id?: string
          status_history?: Json | null
          updated_at?: string | null
          validation_errors?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "document_lifecycle_acknowledged_by_party_id_fkey"
            columns: ["acknowledged_by_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lifecycle_acknowledgment_email_id_fkey"
            columns: ["acknowledgment_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lifecycle_current_revision_id_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "document_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lifecycle_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lifecycle_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      document_revisions: {
        Row: {
          change_summary: string | null
          changed_fields: Json | null
          classification_id: string | null
          content_hash: string | null
          created_at: string | null
          document_type: string
          email_id: string
          id: string
          is_latest: boolean | null
          processed_at: string | null
          received_at: string
          revision_label: string | null
          revision_number: number
          shipment_id: string
        }
        Insert: {
          change_summary?: string | null
          changed_fields?: Json | null
          classification_id?: string | null
          content_hash?: string | null
          created_at?: string | null
          document_type: string
          email_id: string
          id?: string
          is_latest?: boolean | null
          processed_at?: string | null
          received_at: string
          revision_label?: string | null
          revision_number?: number
          shipment_id: string
        }
        Update: {
          change_summary?: string | null
          changed_fields?: Json | null
          classification_id?: string | null
          content_hash?: string | null
          created_at?: string | null
          document_type?: string
          email_id?: string
          id?: string
          is_latest?: boolean | null
          processed_at?: string | null
          received_at?: string
          revision_label?: string | null
          revision_number?: number
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_revisions_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "document_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_revisions_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_revisions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_revisions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      document_type_configs: {
        Row: {
          attachment_filename_patterns: string[] | null
          classification_rules: Json | null
          content_keywords: string[] | null
          created_at: string | null
          display_name: string
          document_category: string
          document_type: string
          email_sender_patterns: string[] | null
          email_subject_patterns: string[] | null
          enabled: boolean | null
          entity_patterns: Json | null
          extraction_template: Json | null
          id: string
          min_confidence_auto_classify: number | null
          min_confidence_auto_link: number | null
          processing_priority: number | null
          requires_attachment: boolean | null
          requires_manual_review: boolean | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          attachment_filename_patterns?: string[] | null
          classification_rules?: Json | null
          content_keywords?: string[] | null
          created_at?: string | null
          display_name: string
          document_category: string
          document_type: string
          email_sender_patterns?: string[] | null
          email_subject_patterns?: string[] | null
          enabled?: boolean | null
          entity_patterns?: Json | null
          extraction_template?: Json | null
          id?: string
          min_confidence_auto_classify?: number | null
          min_confidence_auto_link?: number | null
          processing_priority?: number | null
          requires_attachment?: boolean | null
          requires_manual_review?: boolean | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          attachment_filename_patterns?: string[] | null
          classification_rules?: Json | null
          content_keywords?: string[] | null
          created_at?: string | null
          display_name?: string
          document_category?: string
          document_type?: string
          email_sender_patterns?: string[] | null
          email_subject_patterns?: string[] | null
          enabled?: boolean | null
          entity_patterns?: Json | null
          extraction_template?: Json | null
          id?: string
          min_confidence_auto_classify?: number | null
          min_confidence_auto_link?: number | null
          processing_priority?: number | null
          requires_attachment?: boolean | null
          requires_manual_review?: boolean | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      document_type_requirements: {
        Row: {
          blocking_downstream: string[] | null
          created_at: string | null
          document_description: string | null
          document_type: string
          due_days_offset: number | null
          expected_from: string | null
          expected_sender_patterns: string[] | null
          id: string
          is_active: boolean | null
          is_critical: boolean | null
          required_at_stage: string | null
        }
        Insert: {
          blocking_downstream?: string[] | null
          created_at?: string | null
          document_description?: string | null
          document_type: string
          due_days_offset?: number | null
          expected_from?: string | null
          expected_sender_patterns?: string[] | null
          id?: string
          is_active?: boolean | null
          is_critical?: boolean | null
          required_at_stage?: string | null
        }
        Update: {
          blocking_downstream?: string[] | null
          created_at?: string | null
          document_description?: string | null
          document_type?: string
          due_days_offset?: number | null
          expected_from?: string | null
          expected_sender_patterns?: string[] | null
          id?: string
          is_active?: boolean | null
          is_critical?: boolean | null
          required_at_stage?: string | null
        }
        Relationships: []
      }
      email_routing_rules: {
        Row: {
          action: string
          assign_to_document_type: string | null
          created_at: string | null
          enabled: boolean | null
          id: string
          label_patterns: string[] | null
          rule_name: string
          rule_priority: number | null
          sender_patterns: string[] | null
          subject_patterns: string[] | null
        }
        Insert: {
          action: string
          assign_to_document_type?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          label_patterns?: string[] | null
          rule_name: string
          rule_priority?: number | null
          sender_patterns?: string[] | null
          subject_patterns?: string[] | null
        }
        Update: {
          action?: string
          assign_to_document_type?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          label_patterns?: string[] | null
          rule_name?: string
          rule_priority?: number | null
          sender_patterns?: string[] | null
          subject_patterns?: string[] | null
        }
        Relationships: []
      }
      email_thread_metadata: {
        Row: {
          created_at: string | null
          duplicate_count: number | null
          email_count: number | null
          first_email_id: string | null
          id: string
          latest_email_id: string | null
          primary_bl_number: string | null
          primary_booking_number: string | null
          primary_vessel_name: string | null
          thread_id: string
          thread_subject: string | null
          thread_type: string | null
          unique_email_count: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          duplicate_count?: number | null
          email_count?: number | null
          first_email_id?: string | null
          id?: string
          latest_email_id?: string | null
          primary_bl_number?: string | null
          primary_booking_number?: string | null
          primary_vessel_name?: string | null
          thread_id: string
          thread_subject?: string | null
          thread_type?: string | null
          unique_email_count?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          duplicate_count?: number | null
          email_count?: number | null
          first_email_id?: string | null
          id?: string
          latest_email_id?: string | null
          primary_bl_number?: string | null
          primary_booking_number?: string | null
          primary_vessel_name?: string | null
          thread_id?: string
          thread_subject?: string | null
          thread_type?: string | null
          unique_email_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_thread_metadata_first_email_id_fkey"
            columns: ["first_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_metadata_latest_email_id_fkey"
            columns: ["latest_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_extractions: {
        Row: {
          attachment_id: string | null
          authority_level: number | null
          classification_id: string | null
          confidence_score: number
          context_snippet: string | null
          corrected_value: string | null
          created_at: string | null
          document_revision_id: string | null
          email_id: string | null
          entity_normalized: string | null
          entity_type: string
          entity_value: string
          extracted_at: string | null
          extraction_method: string
          feedback_at: string | null
          feedback_by: string | null
          id: string
          is_correct: boolean | null
          is_from_latest_revision: boolean | null
          is_valid: boolean | null
          is_verified: boolean | null
          position_end: number | null
          position_start: number | null
          revision_number: number | null
          source_document_type: string | null
          validation_errors: Json | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          attachment_id?: string | null
          authority_level?: number | null
          classification_id?: string | null
          confidence_score: number
          context_snippet?: string | null
          corrected_value?: string | null
          created_at?: string | null
          document_revision_id?: string | null
          email_id?: string | null
          entity_normalized?: string | null
          entity_type: string
          entity_value: string
          extracted_at?: string | null
          extraction_method: string
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          is_correct?: boolean | null
          is_from_latest_revision?: boolean | null
          is_valid?: boolean | null
          is_verified?: boolean | null
          position_end?: number | null
          position_start?: number | null
          revision_number?: number | null
          source_document_type?: string | null
          validation_errors?: Json | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          attachment_id?: string | null
          authority_level?: number | null
          classification_id?: string | null
          confidence_score?: number
          context_snippet?: string | null
          corrected_value?: string | null
          created_at?: string | null
          document_revision_id?: string | null
          email_id?: string | null
          entity_normalized?: string | null
          entity_type?: string
          entity_value?: string
          extracted_at?: string | null
          extraction_method?: string
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          is_correct?: boolean | null
          is_from_latest_revision?: boolean | null
          is_valid?: boolean | null
          is_verified?: boolean | null
          position_end?: number | null
          position_start?: number | null
          revision_number?: number | null
          source_document_type?: string | null
          validation_errors?: Json | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_extractions_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "raw_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_extractions_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "document_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_extractions_document_revision_id_fkey"
            columns: ["document_revision_id"]
            isOneToOne: false
            referencedRelation: "document_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_extractions_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_feedback: {
        Row: {
          confidence_adjustment: number | null
          corrected_value: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string
          explanation: string | null
          feedback_id: string
          id: string
          is_incorrect: boolean | null
          is_missing: boolean | null
          original_value: string | null
          should_remove: boolean | null
        }
        Insert: {
          confidence_adjustment?: number | null
          corrected_value?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          explanation?: string | null
          feedback_id: string
          id?: string
          is_incorrect?: boolean | null
          is_missing?: boolean | null
          original_value?: string | null
          should_remove?: boolean | null
        }
        Update: {
          confidence_adjustment?: number | null
          corrected_value?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          explanation?: string | null
          feedback_id?: string
          id?: string
          is_incorrect?: boolean | null
          is_missing?: boolean | null
          original_value?: string | null
          should_remove?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_feedback_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entity_extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_feedback_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "classification_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_feedback_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback_impact_summary"
            referencedColumns: ["feedback_id"]
          },
          {
            foreignKeyName: "entity_feedback_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "pending_feedback_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_prompts: {
        Row: {
          carrier_id: string | null
          created_at: string | null
          document_type: string
          expected_fields: Json
          extraction_instructions: string
          id: string
          is_active: boolean | null
          max_tokens: number | null
          model_name: string | null
          notes: string | null
          prompt_key: string
          system_prompt: string
          temperature: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          carrier_id?: string | null
          created_at?: string | null
          document_type: string
          expected_fields?: Json
          extraction_instructions: string
          id?: string
          is_active?: boolean | null
          max_tokens?: number | null
          model_name?: string | null
          notes?: string | null
          prompt_key: string
          system_prompt: string
          temperature?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          carrier_id?: string | null
          created_at?: string | null
          document_type?: string
          expected_fields?: Json
          extraction_instructions?: string
          id?: string
          is_active?: boolean | null
          max_tokens?: number | null
          model_name?: string | null
          notes?: string | null
          prompt_key?: string
          system_prompt?: string
          temperature?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      extraction_rules: {
        Row: {
          created_at: string | null
          default_value: string | null
          display_name: string
          document_type: string
          extraction_methods: string[] | null
          extraction_patterns: Json
          field_name: string
          field_type: string
          id: string
          is_required: boolean | null
          transformation_rules: Json | null
          validation_rules: Json | null
        }
        Insert: {
          created_at?: string | null
          default_value?: string | null
          display_name: string
          document_type: string
          extraction_methods?: string[] | null
          extraction_patterns: Json
          field_name: string
          field_type: string
          id?: string
          is_required?: boolean | null
          transformation_rules?: Json | null
          validation_rules?: Json | null
        }
        Update: {
          created_at?: string | null
          default_value?: string | null
          display_name?: string
          document_type?: string
          extraction_methods?: string[] | null
          extraction_patterns?: Json
          field_name?: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          transformation_rules?: Json | null
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_rules_document_type_fkey"
            columns: ["document_type"]
            isOneToOne: false
            referencedRelation: "document_type_configs"
            referencedColumns: ["document_type"]
          },
        ]
      }
      feedback_applications: {
        Row: {
          action_type: string | null
          affected_count: number | null
          affected_emails: string[] | null
          after_state: Json | null
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          before_state: Json | null
          changes_summary: Json | null
          created_at: string | null
          feedback_id: string
          id: string
          is_approved: boolean | null
          rejection_reason: string | null
          rule_id: string | null
        }
        Insert: {
          action_type?: string | null
          affected_count?: number | null
          affected_emails?: string[] | null
          after_state?: Json | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before_state?: Json | null
          changes_summary?: Json | null
          created_at?: string | null
          feedback_id: string
          id?: string
          is_approved?: boolean | null
          rejection_reason?: string | null
          rule_id?: string | null
        }
        Update: {
          action_type?: string | null
          affected_count?: number | null
          affected_emails?: string[] | null
          after_state?: Json | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before_state?: Json | null
          changes_summary?: Json | null
          created_at?: string | null
          feedback_id?: string
          id?: string
          is_approved?: boolean | null
          rejection_reason?: string | null
          rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_applications_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "classification_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_applications_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback_impact_summary"
            referencedColumns: ["feedback_id"]
          },
          {
            foreignKeyName: "feedback_applications_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "pending_feedback_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_applications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "classification_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_impact_metrics: {
        Row: {
          accuracy_improvement: number | null
          after_metrics: Json | null
          before_metrics: Json | null
          calculated_at: string | null
          classifications_corrected: number | null
          confidence_avg_after: number | null
          confidence_avg_before: number | null
          emails_affected: number | null
          entities_corrected: number | null
          feedback_id: string
          id: string
          rules_created: number | null
          similar_emails_found: number | null
          similar_emails_processed: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_improvement?: number | null
          after_metrics?: Json | null
          before_metrics?: Json | null
          calculated_at?: string | null
          classifications_corrected?: number | null
          confidence_avg_after?: number | null
          confidence_avg_before?: number | null
          emails_affected?: number | null
          entities_corrected?: number | null
          feedback_id: string
          id?: string
          rules_created?: number | null
          similar_emails_found?: number | null
          similar_emails_processed?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_improvement?: number | null
          after_metrics?: Json | null
          before_metrics?: Json | null
          calculated_at?: string | null
          classifications_corrected?: number | null
          confidence_avg_after?: number | null
          confidence_avg_before?: number | null
          emails_affected?: number | null
          entities_corrected?: number | null
          feedback_id?: string
          id?: string
          rules_created?: number | null
          similar_emails_found?: number | null
          similar_emails_processed?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_impact_metrics_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "classification_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_impact_metrics_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback_impact_summary"
            referencedColumns: ["feedback_id"]
          },
          {
            foreignKeyName: "feedback_impact_metrics_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "pending_feedback_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      identifier_mappings: {
        Row: {
          bl_number: string | null
          booking_number: string | null
          confidence_score: number | null
          container_number: string | null
          created_at: string | null
          hbl_number: string | null
          id: string
          mbl_number: string | null
          source: string
          source_email_id: string | null
          updated_at: string | null
        }
        Insert: {
          bl_number?: string | null
          booking_number?: string | null
          confidence_score?: number | null
          container_number?: string | null
          created_at?: string | null
          hbl_number?: string | null
          id?: string
          mbl_number?: string | null
          source: string
          source_email_id?: string | null
          updated_at?: string | null
        }
        Update: {
          bl_number?: string | null
          booking_number?: string | null
          confidence_score?: number | null
          container_number?: string | null
          created_at?: string | null
          hbl_number?: string | null
          id?: string
          mbl_number?: string | null
          source?: string
          source_email_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      insight_drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string | null
          id: string
          insight_id: string
          recipient_email: string
          recipient_name: string | null
          recipient_type: string
          sent_at: string | null
          sent_message_id: string | null
          shipment_id: string | null
          status: string | null
          subject: string
          template_used: string | null
          updated_at: string | null
          urgency: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body: string
          created_at?: string | null
          id?: string
          insight_id: string
          recipient_email: string
          recipient_name?: string | null
          recipient_type: string
          sent_at?: string | null
          sent_message_id?: string | null
          shipment_id?: string | null
          status?: string | null
          subject: string
          template_used?: string | null
          updated_at?: string | null
          urgency: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string | null
          id?: string
          insight_id?: string
          recipient_email?: string
          recipient_name?: string | null
          recipient_type?: string
          sent_at?: string | null
          sent_message_id?: string | null
          shipment_id?: string | null
          status?: string | null
          subject?: string
          template_used?: string | null
          updated_at?: string | null
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_drafts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_drafts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_feedback: {
        Row: {
          created_at: string | null
          created_by: string | null
          feedback_type: string
          feedback_value: Json | null
          id: string
          insight_id: string | null
          notes: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          feedback_type: string
          feedback_value?: Json | null
          id?: string
          insight_id?: string | null
          notes?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          feedback_type?: string
          feedback_value?: Json | null
          id?: string
          insight_id?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_feedback_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "shipment_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_generation_log: {
        Row: {
          ai_analysis_ran: boolean | null
          ai_insights_generated: number | null
          completed_at: string | null
          duration_ms: number | null
          error_message: string | null
          generation_type: string
          id: string
          priority_boost_applied: number | null
          rules_patterns_checked: number | null
          rules_patterns_matched: number | null
          shipment_id: string | null
          started_at: string | null
          total_insights_generated: number | null
        }
        Insert: {
          ai_analysis_ran?: boolean | null
          ai_insights_generated?: number | null
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          generation_type: string
          id?: string
          priority_boost_applied?: number | null
          rules_patterns_checked?: number | null
          rules_patterns_matched?: number | null
          shipment_id?: string | null
          started_at?: string | null
          total_insights_generated?: number | null
        }
        Update: {
          ai_analysis_ran?: boolean | null
          ai_insights_generated?: number | null
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          generation_type?: string
          id?: string
          priority_boost_applied?: number | null
          rules_patterns_checked?: number | null
          rules_patterns_matched?: number | null
          shipment_id?: string | null
          started_at?: string | null
          total_insights_generated?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_generation_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_generation_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_patterns: {
        Row: {
          category: string
          check_function: string | null
          created_at: string | null
          description: string | null
          enabled: boolean | null
          id: string
          name: string
          pattern_code: string
          priority_boost: number | null
          severity: string
          updated_at: string | null
        }
        Insert: {
          category: string
          check_function?: string | null
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          name: string
          pattern_code: string
          priority_boost?: number | null
          severity: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          check_function?: string | null
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          name?: string
          pattern_code?: string
          priority_boost?: number | null
          severity?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      linking_rules: {
        Row: {
          base_confidence: number | null
          confidence_boost_per_match: number | null
          created_at: string | null
          date_range_days: number | null
          enabled: boolean | null
          id: string
          match_strategy: string
          matching_entity_types: string[]
          min_matches_required: number | null
          must_match_carrier: boolean | null
          must_match_customer: boolean | null
          rule_description: string | null
          rule_logic: Json | null
          rule_name: string
          rule_priority: number | null
          updated_at: string | null
        }
        Insert: {
          base_confidence?: number | null
          confidence_boost_per_match?: number | null
          created_at?: string | null
          date_range_days?: number | null
          enabled?: boolean | null
          id?: string
          match_strategy: string
          matching_entity_types: string[]
          min_matches_required?: number | null
          must_match_carrier?: boolean | null
          must_match_customer?: boolean | null
          rule_description?: string | null
          rule_logic?: Json | null
          rule_name: string
          rule_priority?: number | null
          updated_at?: string | null
        }
        Update: {
          base_confidence?: number | null
          confidence_boost_per_match?: number | null
          created_at?: string | null
          date_range_days?: number | null
          enabled?: boolean | null
          id?: string
          match_strategy?: string
          matching_entity_types?: string[]
          min_matches_required?: number | null
          must_match_carrier?: boolean | null
          must_match_customer?: boolean | null
          rule_description?: string | null
          rule_logic?: Json | null
          rule_name?: string
          rule_priority?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      milestone_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_message: string
          alert_severity: string
          alert_type: string
          created_at: string | null
          id: string
          is_acknowledged: boolean | null
          milestone_id: string
          shipment_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_message: string
          alert_severity?: string
          alert_type: string
          created_at?: string | null
          id?: string
          is_acknowledged?: boolean | null
          milestone_id: string
          shipment_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_message?: string
          alert_severity?: string
          alert_type?: string
          created_at?: string | null
          id?: string
          is_acknowledged?: boolean | null
          milestone_id?: string
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_alerts_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "shipment_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_alerts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_alerts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_definitions: {
        Row: {
          created_at: string | null
          description: string | null
          document_types: string[] | null
          expected_days_after_eta: number | null
          expected_days_before_etd: number | null
          id: string
          is_critical: boolean | null
          milestone_code: string
          milestone_name: string
          milestone_order: number
          milestone_phase: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          document_types?: string[] | null
          expected_days_after_eta?: number | null
          expected_days_before_etd?: number | null
          id?: string
          is_critical?: boolean | null
          milestone_code: string
          milestone_name: string
          milestone_order: number
          milestone_phase: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          document_types?: string[] | null
          expected_days_after_eta?: number | null
          expected_days_before_etd?: number | null
          id?: string
          is_critical?: boolean | null
          milestone_code?: string
          milestone_name?: string
          milestone_order?: number
          milestone_phase?: string
        }
        Relationships: []
      }
      missing_document_alerts: {
        Row: {
          alert_status: string
          created_at: string | null
          document_description: string | null
          document_type: string
          expected_by: string
          id: string
          last_reminder_at: string | null
          next_reminder_at: string | null
          reminder_count: number | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          updated_at: string | null
        }
        Insert: {
          alert_status?: string
          created_at?: string | null
          document_description?: string | null
          document_type: string
          expected_by: string
          id?: string
          last_reminder_at?: string | null
          next_reminder_at?: string | null
          reminder_count?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id: string
          updated_at?: string | null
        }
        Update: {
          alert_status?: string
          created_at?: string | null
          document_description?: string | null
          document_type?: string
          expected_by?: string
          id?: string
          last_reminder_at?: string | null
          next_reminder_at?: string | null
          reminder_count?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missing_document_alerts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missing_document_alerts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_actions: {
        Row: {
          action_details: Json | null
          action_type: string
          id: string
          notes: string | null
          notification_id: string
          performed_at: string | null
          performed_by: string | null
          performed_by_name: string | null
          related_email_id: string | null
          related_task_id: string | null
        }
        Insert: {
          action_details?: Json | null
          action_type: string
          id?: string
          notes?: string | null
          notification_id: string
          performed_at?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          related_email_id?: string | null
          related_task_id?: string | null
        }
        Update: {
          action_details?: Json | null
          action_type?: string
          id?: string
          notes?: string | null
          notification_id?: string
          performed_at?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          related_email_id?: string | null
          related_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_actions_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_type_configs: {
        Row: {
          auto_generate_task: boolean | null
          body_keywords: string[] | null
          category: string
          created_at: string | null
          default_priority: string
          default_urgency_hours: number | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean | null
          notification_type: string
          sender_patterns: string[] | null
          subject_patterns: string[] | null
          task_template_code: string | null
          updated_at: string | null
        }
        Insert: {
          auto_generate_task?: boolean | null
          body_keywords?: string[] | null
          category: string
          created_at?: string | null
          default_priority?: string
          default_urgency_hours?: number | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          notification_type: string
          sender_patterns?: string[] | null
          subject_patterns?: string[] | null
          task_template_code?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_generate_task?: boolean | null
          body_keywords?: string[] | null
          category?: string
          created_at?: string | null
          default_priority?: string
          default_urgency_hours?: number | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          notification_type?: string
          sender_patterns?: string[] | null
          subject_patterns?: string[] | null
          task_template_code?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          carrier_id: string | null
          classification_confidence: number | null
          created_at: string | null
          deadline_date: string | null
          email_id: string
          extracted_data: Json | null
          id: string
          notification_type: string | null
          original_subject: string | null
          party_id: string | null
          priority: string
          processed_at: string | null
          received_at: string
          sender_email: string | null
          sender_name: string | null
          shipment_id: string | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          summary: string | null
          title: string
          urgency_score: number | null
        }
        Insert: {
          carrier_id?: string | null
          classification_confidence?: number | null
          created_at?: string | null
          deadline_date?: string | null
          email_id: string
          extracted_data?: Json | null
          id?: string
          notification_type?: string | null
          original_subject?: string | null
          party_id?: string | null
          priority?: string
          processed_at?: string | null
          received_at: string
          sender_email?: string | null
          sender_name?: string | null
          shipment_id?: string | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          summary?: string | null
          title: string
          urgency_score?: number | null
        }
        Update: {
          carrier_id?: string | null
          classification_confidence?: number | null
          created_at?: string | null
          deadline_date?: string | null
          email_id?: string
          extracted_data?: Json | null
          id?: string
          notification_type?: string | null
          original_subject?: string | null
          party_id?: string | null
          priority?: string
          processed_at?: string | null
          received_at?: string
          sender_email?: string | null
          sender_name?: string | null
          shipment_id?: string | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          summary?: string | null
          title?: string
          urgency_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: true
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_notification_type_fkey"
            columns: ["notification_type"]
            isOneToOne: false
            referencedRelation: "notification_type_configs"
            referencedColumns: ["notification_type"]
          },
          {
            foreignKeyName: "notifications_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          address: string | null
          city: string | null
          common_routes: Json | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          created_at: string | null
          customer_relationship: string | null
          documentation_quality_score: number | null
          email_domains: string[] | null
          id: string
          is_customer: boolean | null
          party_name: string
          party_type: string
          postal_code: string | null
          reliability_score: number | null
          response_time_avg_hours: number | null
          tax_id: string | null
          total_cost: number | null
          total_revenue: number | null
          total_shipments: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          common_routes?: Json | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string | null
          customer_relationship?: string | null
          documentation_quality_score?: number | null
          email_domains?: string[] | null
          id?: string
          is_customer?: boolean | null
          party_name: string
          party_type: string
          postal_code?: string | null
          reliability_score?: number | null
          response_time_avg_hours?: number | null
          tax_id?: string | null
          total_cost?: number | null
          total_revenue?: number | null
          total_shipments?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          common_routes?: Json | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string | null
          customer_relationship?: string | null
          documentation_quality_score?: number | null
          email_domains?: string[] | null
          id?: string
          is_customer?: boolean | null
          party_name?: string
          party_type?: string
          postal_code?: string | null
          reliability_score?: number | null
          response_time_avg_hours?: number | null
          tax_id?: string | null
          total_cost?: number | null
          total_revenue?: number | null
          total_shipments?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      party_domain_mappings: {
        Row: {
          carrier_code: string | null
          created_at: string | null
          email_domain: string
          email_pattern: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          party_name: string | null
          party_type: string
          updated_at: string | null
        }
        Insert: {
          carrier_code?: string | null
          created_at?: string | null
          email_domain: string
          email_pattern?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          party_name?: string | null
          party_type: string
          updated_at?: string | null
        }
        Update: {
          carrier_code?: string | null
          created_at?: string | null
          email_domain?: string
          email_pattern?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          party_name?: string | null
          party_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      raw_attachments: {
        Row: {
          attachment_id: string | null
          created_at: string | null
          email_id: string
          extracted_at: string | null
          extracted_text: string | null
          extraction_error: string | null
          extraction_status: string | null
          filename: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          attachment_id?: string | null
          created_at?: string | null
          email_id: string
          extracted_at?: string | null
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string | null
          filename: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          attachment_id?: string | null
          created_at?: string | null
          email_id?: string
          extracted_at?: string | null
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string | null
          filename?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_attachments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_email_metadata: {
        Row: {
          created_at: string | null
          custom_headers: Json | null
          dkim_result: string | null
          email_id: string
          email_references: string[] | null
          id: string
          in_reply_to: string | null
          received_headers: Json | null
          spf_result: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string | null
          custom_headers?: Json | null
          dkim_result?: string | null
          email_id: string
          email_references?: string[] | null
          id?: string
          in_reply_to?: string | null
          received_headers?: Json | null
          spf_result?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string | null
          custom_headers?: Json | null
          dkim_result?: string | null
          email_id?: string
          email_references?: string[] | null
          id?: string
          in_reply_to?: string | null
          received_headers?: Json | null
          spf_result?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_email_metadata_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_emails: {
        Row: {
          attachment_count: number | null
          body_html: string | null
          body_text: string | null
          content_hash: string | null
          created_at: string | null
          duplicate_of_email_id: string | null
          email_direction: string | null
          fetched_at: string | null
          gmail_message_id: string
          has_attachments: boolean | null
          headers: Json | null
          id: string
          in_reply_to_message_id: string | null
          is_duplicate: boolean | null
          is_response: boolean | null
          labels: string[] | null
          processed_at: string | null
          processing_error: string | null
          processing_status: string | null
          received_at: string
          recipient_emails: string[] | null
          responds_to_email_id: string | null
          response_time_hours: number | null
          revision_type: string | null
          sender_email: string
          sender_name: string | null
          snippet: string | null
          subject: string
          thread_id: string | null
          thread_position: number | null
          true_sender_email: string | null
          updated_at: string | null
        }
        Insert: {
          attachment_count?: number | null
          body_html?: string | null
          body_text?: string | null
          content_hash?: string | null
          created_at?: string | null
          duplicate_of_email_id?: string | null
          email_direction?: string | null
          fetched_at?: string | null
          gmail_message_id: string
          has_attachments?: boolean | null
          headers?: Json | null
          id?: string
          in_reply_to_message_id?: string | null
          is_duplicate?: boolean | null
          is_response?: boolean | null
          labels?: string[] | null
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string | null
          received_at: string
          recipient_emails?: string[] | null
          responds_to_email_id?: string | null
          response_time_hours?: number | null
          revision_type?: string | null
          sender_email: string
          sender_name?: string | null
          snippet?: string | null
          subject: string
          thread_id?: string | null
          thread_position?: number | null
          true_sender_email?: string | null
          updated_at?: string | null
        }
        Update: {
          attachment_count?: number | null
          body_html?: string | null
          body_text?: string | null
          content_hash?: string | null
          created_at?: string | null
          duplicate_of_email_id?: string | null
          email_direction?: string | null
          fetched_at?: string | null
          gmail_message_id?: string
          has_attachments?: boolean | null
          headers?: Json | null
          id?: string
          in_reply_to_message_id?: string | null
          is_duplicate?: boolean | null
          is_response?: boolean | null
          labels?: string[] | null
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string | null
          received_at?: string
          recipient_emails?: string[] | null
          responds_to_email_id?: string | null
          response_time_hours?: number | null
          revision_type?: string | null
          sender_email?: string
          sender_name?: string | null
          snippet?: string | null
          subject?: string
          thread_id?: string | null
          thread_position?: number | null
          true_sender_email?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_emails_duplicate_of_email_id_fkey"
            columns: ["duplicate_of_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_emails_responds_to_email_id_fkey"
            columns: ["responds_to_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_audit_log: {
        Row: {
          action: string
          change_summary: string | null
          changed_fields: Json | null
          created_at: string | null
          id: string
          shipment_id: string
          source: string
          source_email_id: string | null
          source_user_id: string | null
        }
        Insert: {
          action: string
          change_summary?: string | null
          changed_fields?: Json | null
          created_at?: string | null
          id?: string
          shipment_id: string
          source: string
          source_email_id?: string | null
          source_user_id?: string | null
        }
        Update: {
          action?: string
          change_summary?: string | null
          changed_fields?: Json | null
          created_at?: string | null
          id?: string
          shipment_id?: string
          source?: string
          source_email_id?: string | null
          source_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_audit_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audit_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audit_log_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_blockers: {
        Row: {
          auto_resolved: boolean | null
          blocked_since: string
          blocker_description: string
          blocker_type: string
          blocks_document_type: string | null
          blocks_milestone: string | null
          blocks_workflow_state: string | null
          created_at: string | null
          id: string
          is_resolved: boolean | null
          linked_document_lifecycle_id: string | null
          linked_email_id: string | null
          linked_notification_id: string | null
          linked_task_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          shipment_id: string
          updated_at: string | null
        }
        Insert: {
          auto_resolved?: boolean | null
          blocked_since?: string
          blocker_description: string
          blocker_type: string
          blocks_document_type?: string | null
          blocks_milestone?: string | null
          blocks_workflow_state?: string | null
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          linked_document_lifecycle_id?: string | null
          linked_email_id?: string | null
          linked_notification_id?: string | null
          linked_task_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          shipment_id: string
          updated_at?: string | null
        }
        Update: {
          auto_resolved?: boolean | null
          blocked_since?: string
          blocker_description?: string
          blocker_type?: string
          blocks_document_type?: string | null
          blocks_milestone?: string | null
          blocks_workflow_state?: string | null
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          linked_document_lifecycle_id?: string | null
          linked_email_id?: string | null
          linked_notification_id?: string | null
          linked_task_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          shipment_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_blockers_linked_document_lifecycle_id_fkey"
            columns: ["linked_document_lifecycle_id"]
            isOneToOne: false
            referencedRelation: "document_lifecycle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_blockers_linked_email_id_fkey"
            columns: ["linked_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_blockers_linked_notification_id_fkey"
            columns: ["linked_notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_blockers_linked_task_id_fkey"
            columns: ["linked_task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_blockers_linked_task_id_fkey"
            columns: ["linked_task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_blockers_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_blockers_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_containers: {
        Row: {
          container_number: string
          container_type: string | null
          created_at: string | null
          dimension_unit: string | null
          gross_weight: number | null
          hazmat_un_number: string | null
          height: number | null
          id: string
          is_hazmat: boolean | null
          is_reefer: boolean | null
          iso_type_code: string | null
          length: number | null
          net_weight: number | null
          seal_number: string | null
          seal_type: string | null
          shipment_id: string
          tare_weight: number | null
          temperature_setting: number | null
          temperature_unit: string | null
          updated_at: string | null
          weight_unit: string | null
          width: number | null
        }
        Insert: {
          container_number: string
          container_type?: string | null
          created_at?: string | null
          dimension_unit?: string | null
          gross_weight?: number | null
          hazmat_un_number?: string | null
          height?: number | null
          id?: string
          is_hazmat?: boolean | null
          is_reefer?: boolean | null
          iso_type_code?: string | null
          length?: number | null
          net_weight?: number | null
          seal_number?: string | null
          seal_type?: string | null
          shipment_id: string
          tare_weight?: number | null
          temperature_setting?: number | null
          temperature_unit?: string | null
          updated_at?: string | null
          weight_unit?: string | null
          width?: number | null
        }
        Update: {
          container_number?: string
          container_type?: string | null
          created_at?: string | null
          dimension_unit?: string | null
          gross_weight?: number | null
          hazmat_un_number?: string | null
          height?: number | null
          id?: string
          is_hazmat?: boolean | null
          is_reefer?: boolean | null
          iso_type_code?: string | null
          length?: number | null
          net_weight?: number | null
          seal_number?: string | null
          seal_type?: string | null
          shipment_id?: string
          tare_weight?: number | null
          temperature_setting?: number | null
          temperature_unit?: string | null
          updated_at?: string | null
          weight_unit?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_containers_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_containers_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_documents: {
        Row: {
          booking_number_extracted: string | null
          classification_id: string | null
          created_at: string | null
          document_date: string | null
          document_number: string | null
          document_type: string
          email_id: string
          id: string
          is_primary: boolean | null
          link_confidence_score: number | null
          link_method: string | null
          linked_at: string | null
          linked_by: string | null
          matched_bl_number: string | null
          matched_booking_number: string | null
          matched_container_number: string | null
          shipment_id: string | null
          status: string | null
        }
        Insert: {
          booking_number_extracted?: string | null
          classification_id?: string | null
          created_at?: string | null
          document_date?: string | null
          document_number?: string | null
          document_type: string
          email_id: string
          id?: string
          is_primary?: boolean | null
          link_confidence_score?: number | null
          link_method?: string | null
          linked_at?: string | null
          linked_by?: string | null
          matched_bl_number?: string | null
          matched_booking_number?: string | null
          matched_container_number?: string | null
          shipment_id?: string | null
          status?: string | null
        }
        Update: {
          booking_number_extracted?: string | null
          classification_id?: string | null
          created_at?: string | null
          document_date?: string | null
          document_number?: string | null
          document_type?: string
          email_id?: string
          id?: string
          is_primary?: boolean | null
          link_confidence_score?: number | null
          link_method?: string | null
          linked_at?: string | null
          linked_by?: string | null
          matched_bl_number?: string | null
          matched_booking_number?: string | null
          matched_container_number?: string | null
          shipment_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_documents_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "document_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_documents_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_documents_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_documents_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          created_at: string | null
          description: string | null
          event_date: string
          event_type: string
          id: string
          is_milestone: boolean | null
          location: string | null
          location_code: string | null
          shipment_id: string
          source_email_id: string | null
          source_type: string | null
          source_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_date: string
          event_type: string
          id?: string
          is_milestone?: boolean | null
          location?: string | null
          location_code?: string | null
          shipment_id: string
          source_email_id?: string | null
          source_type?: string | null
          source_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_date?: string
          event_type?: string
          id?: string
          is_milestone?: boolean | null
          location?: string | null
          location_code?: string | null
          shipment_id?: string
          source_email_id?: string | null
          source_type?: string | null
          source_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_financials: {
        Row: {
          amount: number
          created_at: string | null
          currency: string
          description: string | null
          id: string
          invoice_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_type: string | null
          paid_amount: number | null
          paid_date: string | null
          payment_due_date: string | null
          payment_status: string | null
          payment_terms: string | null
          shipment_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency: string
          description?: string | null
          id?: string
          invoice_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          payment_due_date?: string | null
          payment_status?: string | null
          payment_terms?: string | null
          shipment_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string
          description?: string | null
          id?: string
          invoice_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          payment_due_date?: string | null
          payment_status?: string | null
          payment_terms?: string | null
          shipment_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_financials_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_financials_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_financials_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_insights: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          boost_reason: string | null
          confidence: number | null
          description: string
          expires_at: string | null
          generated_at: string | null
          id: string
          insight_type: string
          pattern_id: string | null
          priority_boost: number | null
          recommended_action: string | null
          resolved_at: string | null
          severity: string
          shipment_id: string | null
          source: string
          status: string | null
          supporting_data: Json | null
          task_id: string | null
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          boost_reason?: string | null
          confidence?: number | null
          description: string
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          insight_type: string
          pattern_id?: string | null
          priority_boost?: number | null
          recommended_action?: string | null
          resolved_at?: string | null
          severity: string
          shipment_id?: string | null
          source: string
          status?: string | null
          supporting_data?: Json | null
          task_id?: string | null
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          boost_reason?: string | null
          confidence?: number | null
          description?: string
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          insight_type?: string
          pattern_id?: string | null
          priority_boost?: number | null
          recommended_action?: string | null
          resolved_at?: string | null
          severity?: string
          shipment_id?: string | null
          source?: string
          status?: string | null
          supporting_data?: Json | null
          task_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_insights_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "insight_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_insights_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_insights_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_insights_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_insights_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_journey_events: {
        Row: {
          blocker_id: string | null
          created_at: string | null
          direction: string | null
          document_lifecycle_id: string | null
          email_id: string | null
          event_category: string
          event_data: Json | null
          event_description: string
          event_type: string
          id: string
          milestone_id: string | null
          notification_id: string | null
          occurred_at: string
          party_id: string | null
          party_name: string | null
          party_type: string | null
          shipment_id: string
          task_id: string | null
          workflow_state_after: string | null
          workflow_state_before: string | null
        }
        Insert: {
          blocker_id?: string | null
          created_at?: string | null
          direction?: string | null
          document_lifecycle_id?: string | null
          email_id?: string | null
          event_category: string
          event_data?: Json | null
          event_description: string
          event_type: string
          id?: string
          milestone_id?: string | null
          notification_id?: string | null
          occurred_at: string
          party_id?: string | null
          party_name?: string | null
          party_type?: string | null
          shipment_id: string
          task_id?: string | null
          workflow_state_after?: string | null
          workflow_state_before?: string | null
        }
        Update: {
          blocker_id?: string | null
          created_at?: string | null
          direction?: string | null
          document_lifecycle_id?: string | null
          email_id?: string | null
          event_category?: string
          event_data?: Json | null
          event_description?: string
          event_type?: string
          id?: string
          milestone_id?: string | null
          notification_id?: string | null
          occurred_at?: string
          party_id?: string | null
          party_name?: string | null
          party_type?: string | null
          shipment_id?: string
          task_id?: string | null
          workflow_state_after?: string | null
          workflow_state_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_journey_events_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "shipment_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_document_lifecycle_id_fkey"
            columns: ["document_lifecycle_id"]
            isOneToOne: false
            referencedRelation: "document_lifecycle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "shipment_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_journey_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_link_candidates: {
        Row: {
          confidence_score: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          email_id: string
          id: string
          is_confirmed: boolean | null
          is_rejected: boolean | null
          link_type: string
          match_reasoning: string | null
          matched_value: string
          rejection_reason: string | null
          shipment_id: string | null
        }
        Insert: {
          confidence_score: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          email_id: string
          id?: string
          is_confirmed?: boolean | null
          is_rejected?: boolean | null
          link_type: string
          match_reasoning?: string | null
          matched_value: string
          rejection_reason?: string | null
          shipment_id?: string | null
        }
        Update: {
          confidence_score?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          email_id?: string
          id?: string
          is_confirmed?: boolean | null
          is_rejected?: boolean | null
          link_type?: string
          match_reasoning?: string | null
          matched_value?: string
          rejection_reason?: string | null
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_link_candidates_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_link_candidates_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_link_candidates_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_milestones: {
        Row: {
          achieved_date: string | null
          created_at: string | null
          expected_date: string | null
          id: string
          metadata: Json | null
          milestone_code: string
          milestone_status: string
          missed_since: string | null
          notes: string | null
          shipment_id: string
          triggered_by_email_id: string | null
          triggered_by_user_id: string | null
          updated_at: string | null
        }
        Insert: {
          achieved_date?: string | null
          created_at?: string | null
          expected_date?: string | null
          id?: string
          metadata?: Json | null
          milestone_code: string
          milestone_status?: string
          missed_since?: string | null
          notes?: string | null
          shipment_id: string
          triggered_by_email_id?: string | null
          triggered_by_user_id?: string | null
          updated_at?: string | null
        }
        Update: {
          achieved_date?: string | null
          created_at?: string | null
          expected_date?: string | null
          id?: string
          metadata?: Json | null
          milestone_code?: string
          milestone_status?: string
          missed_since?: string | null
          notes?: string | null
          shipment_id?: string
          triggered_by_email_id?: string | null
          triggered_by_user_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_milestones_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_milestones_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_milestones_triggered_by_email_id_fkey"
            columns: ["triggered_by_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_parties: {
        Row: {
          created_at: string | null
          id: string
          license_number: string | null
          party_address: string | null
          party_contact_person: string | null
          party_email: string | null
          party_id_fk: string | null
          party_name: string
          party_phone: string | null
          party_role: string
          shipment_id: string
          tax_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          license_number?: string | null
          party_address?: string | null
          party_contact_person?: string | null
          party_email?: string | null
          party_id_fk?: string | null
          party_name: string
          party_phone?: string | null
          party_role: string
          shipment_id: string
          tax_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          license_number?: string | null
          party_address?: string | null
          party_contact_person?: string | null
          party_email?: string | null
          party_id_fk?: string | null
          party_name?: string
          party_phone?: string | null
          party_role?: string
          shipment_id?: string
          tax_id?: string | null
        }
        Relationships: []
      }
      shipment_workflow_events: {
        Row: {
          created_at: string | null
          document_id: string | null
          document_type: string | null
          email_direction: string | null
          email_id: string | null
          id: string
          occurred_at: string | null
          shipment_id: string
          workflow_state: string
        }
        Insert: {
          created_at?: string | null
          document_id?: string | null
          document_type?: string | null
          email_direction?: string | null
          email_id?: string | null
          id?: string
          occurred_at?: string | null
          shipment_id: string
          workflow_state: string
        }
        Update: {
          created_at?: string | null
          document_id?: string | null
          document_type?: string | null
          email_direction?: string | null
          email_id?: string | null
          id?: string
          occurred_at?: string | null
          shipment_id?: string
          workflow_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_workflow_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "shipment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_workflow_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_workflow_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_workflow_history: {
        Row: {
          created_at: string | null
          email_direction: string | null
          from_state: string | null
          id: string
          shipment_id: string
          to_state: string
          transition_notes: string | null
          triggered_by_document_type: string | null
          triggered_by_email_id: string | null
          triggered_by_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email_direction?: string | null
          from_state?: string | null
          id?: string
          shipment_id: string
          to_state: string
          transition_notes?: string | null
          triggered_by_document_type?: string | null
          triggered_by_email_id?: string | null
          triggered_by_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email_direction?: string | null
          from_state?: string | null
          id?: string
          shipment_id?: string
          to_state?: string
          transition_notes?: string | null
          triggered_by_document_type?: string | null
          triggered_by_email_id?: string | null
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_workflow_history_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_workflow_history_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_workflow_history_triggered_by_email_id_fkey"
            columns: ["triggered_by_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_workflow_states: {
        Row: {
          created_at: string | null
          description: string | null
          expected_direction: string | null
          id: string
          is_milestone: boolean | null
          is_optional: boolean | null
          next_states: string[] | null
          phase: string
          requires_document_types: string[] | null
          state_code: string
          state_name: string
          state_order: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          expected_direction?: string | null
          id?: string
          is_milestone?: boolean | null
          is_optional?: boolean | null
          next_states?: string[] | null
          phase: string
          requires_document_types?: string[] | null
          state_code: string
          state_name: string
          state_order: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          expected_direction?: string | null
          id?: string
          is_milestone?: boolean | null
          is_optional?: boolean | null
          next_states?: string[] | null
          phase?: string
          requires_document_types?: string[] | null
          state_code?: string
          state_name?: string
          state_order?: number
        }
        Relationships: []
      }
      shipments: {
        Row: {
          ata: string | null
          atd: string | null
          bl_number: string | null
          booking_number: string | null
          booking_revision_count: number | null
          cargo_cutoff: string | null
          cargo_description: string | null
          cargo_ready_date: string | null
          carrier_id: string | null
          commodity_description: string | null
          consignee_address: string | null
          consignee_id: string | null
          consignee_name: string | null
          container_number_primary: string | null
          container_numbers: string[] | null
          created_at: string | null
          created_from_email_id: string | null
          customer_id: string | null
          discharge_terminal: string | null
          doc_cutoff: string | null
          duty_amount: number | null
          duty_currency: string | null
          entry_date: string | null
          entry_number: string | null
          eta: string | null
          etd: string | null
          feeder_vessel: string | null
          feeder_voyage: string | null
          final_destination: string | null
          final_destination_code: string | null
          free_time_expires: string | null
          freight_terms: string | null
          gate_cutoff: string | null
          gross_weight: number | null
          hbl_number: string | null
          hbl_revision_count: number | null
          hs_code_customs: string | null
          hs_code_shipper: string | null
          id: string
          incoterms: string | null
          invoice_number: string | null
          is_direct_carrier_confirmed: boolean | null
          it_number: string | null
          last_document_update: string | null
          mbl_number: string | null
          milestones_achieved: number | null
          milestones_missed: number | null
          milestones_total: number | null
          next_milestone: string | null
          next_milestone_date: string | null
          notify_party_address: string | null
          notify_party_id: string | null
          notify_party_name: string | null
          package_type: string | null
          place_of_delivery: string | null
          place_of_receipt: string | null
          port_of_discharge: string | null
          port_of_discharge_code: string | null
          port_of_loading: string | null
          port_of_loading_code: string | null
          priority_tier: string | null
          seal_numbers: string[] | null
          shipper_address: string | null
          shipper_id: string | null
          shipper_name: string | null
          si_block_reason: string | null
          si_can_submit: boolean | null
          si_cutoff: string | null
          si_reconciliation_status: string | null
          si_revision_count: number | null
          status: string | null
          status_updated_at: string | null
          terminal: string | null
          total_packages: number | null
          total_volume: number | null
          total_weight: number | null
          updated_at: string | null
          vessel_name: string | null
          vgm_cutoff: string | null
          volume_unit: string | null
          voyage_number: string | null
          weight_unit: string | null
          workflow_phase: string | null
          workflow_state: string | null
          workflow_state_updated_at: string | null
        }
        Insert: {
          ata?: string | null
          atd?: string | null
          bl_number?: string | null
          booking_number?: string | null
          booking_revision_count?: number | null
          cargo_cutoff?: string | null
          cargo_description?: string | null
          cargo_ready_date?: string | null
          carrier_id?: string | null
          commodity_description?: string | null
          consignee_address?: string | null
          consignee_id?: string | null
          consignee_name?: string | null
          container_number_primary?: string | null
          container_numbers?: string[] | null
          created_at?: string | null
          created_from_email_id?: string | null
          customer_id?: string | null
          discharge_terminal?: string | null
          doc_cutoff?: string | null
          duty_amount?: number | null
          duty_currency?: string | null
          entry_date?: string | null
          entry_number?: string | null
          eta?: string | null
          etd?: string | null
          feeder_vessel?: string | null
          feeder_voyage?: string | null
          final_destination?: string | null
          final_destination_code?: string | null
          free_time_expires?: string | null
          freight_terms?: string | null
          gate_cutoff?: string | null
          gross_weight?: number | null
          hbl_number?: string | null
          hbl_revision_count?: number | null
          hs_code_customs?: string | null
          hs_code_shipper?: string | null
          id?: string
          incoterms?: string | null
          invoice_number?: string | null
          is_direct_carrier_confirmed?: boolean | null
          it_number?: string | null
          last_document_update?: string | null
          mbl_number?: string | null
          milestones_achieved?: number | null
          milestones_missed?: number | null
          milestones_total?: number | null
          next_milestone?: string | null
          next_milestone_date?: string | null
          notify_party_address?: string | null
          notify_party_id?: string | null
          notify_party_name?: string | null
          package_type?: string | null
          place_of_delivery?: string | null
          place_of_receipt?: string | null
          port_of_discharge?: string | null
          port_of_discharge_code?: string | null
          port_of_loading?: string | null
          port_of_loading_code?: string | null
          priority_tier?: string | null
          seal_numbers?: string[] | null
          shipper_address?: string | null
          shipper_id?: string | null
          shipper_name?: string | null
          si_block_reason?: string | null
          si_can_submit?: boolean | null
          si_cutoff?: string | null
          si_reconciliation_status?: string | null
          si_revision_count?: number | null
          status?: string | null
          status_updated_at?: string | null
          terminal?: string | null
          total_packages?: number | null
          total_volume?: number | null
          total_weight?: number | null
          updated_at?: string | null
          vessel_name?: string | null
          vgm_cutoff?: string | null
          volume_unit?: string | null
          voyage_number?: string | null
          weight_unit?: string | null
          workflow_phase?: string | null
          workflow_state?: string | null
          workflow_state_updated_at?: string | null
        }
        Update: {
          ata?: string | null
          atd?: string | null
          bl_number?: string | null
          booking_number?: string | null
          booking_revision_count?: number | null
          cargo_cutoff?: string | null
          cargo_description?: string | null
          cargo_ready_date?: string | null
          carrier_id?: string | null
          commodity_description?: string | null
          consignee_address?: string | null
          consignee_id?: string | null
          consignee_name?: string | null
          container_number_primary?: string | null
          container_numbers?: string[] | null
          created_at?: string | null
          created_from_email_id?: string | null
          customer_id?: string | null
          discharge_terminal?: string | null
          doc_cutoff?: string | null
          duty_amount?: number | null
          duty_currency?: string | null
          entry_date?: string | null
          entry_number?: string | null
          eta?: string | null
          etd?: string | null
          feeder_vessel?: string | null
          feeder_voyage?: string | null
          final_destination?: string | null
          final_destination_code?: string | null
          free_time_expires?: string | null
          freight_terms?: string | null
          gate_cutoff?: string | null
          gross_weight?: number | null
          hbl_number?: string | null
          hbl_revision_count?: number | null
          hs_code_customs?: string | null
          hs_code_shipper?: string | null
          id?: string
          incoterms?: string | null
          invoice_number?: string | null
          is_direct_carrier_confirmed?: boolean | null
          it_number?: string | null
          last_document_update?: string | null
          mbl_number?: string | null
          milestones_achieved?: number | null
          milestones_missed?: number | null
          milestones_total?: number | null
          next_milestone?: string | null
          next_milestone_date?: string | null
          notify_party_address?: string | null
          notify_party_id?: string | null
          notify_party_name?: string | null
          package_type?: string | null
          place_of_delivery?: string | null
          place_of_receipt?: string | null
          port_of_discharge?: string | null
          port_of_discharge_code?: string | null
          port_of_loading?: string | null
          port_of_loading_code?: string | null
          priority_tier?: string | null
          seal_numbers?: string[] | null
          shipper_address?: string | null
          shipper_id?: string | null
          shipper_name?: string | null
          si_block_reason?: string | null
          si_can_submit?: boolean | null
          si_cutoff?: string | null
          si_reconciliation_status?: string | null
          si_revision_count?: number | null
          status?: string | null
          status_updated_at?: string | null
          terminal?: string | null
          total_packages?: number | null
          total_volume?: number | null
          total_weight?: number | null
          updated_at?: string | null
          vessel_name?: string | null
          vgm_cutoff?: string | null
          volume_unit?: string | null
          voyage_number?: string | null
          weight_unit?: string | null
          workflow_phase?: string | null
          workflow_state?: string | null
          workflow_state_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_consignee_id_fkey"
            columns: ["consignee_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_created_from_email_id_fkey"
            columns: ["created_from_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_notify_party_id_fkey"
            columns: ["notify_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_shipper_id_fkey"
            columns: ["shipper_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      si_reconciliation_fields: {
        Row: {
          applies_to_checklist: boolean | null
          applies_to_hbl: boolean | null
          comparison_type: string
          created_at: string | null
          description: string | null
          field_label: string
          field_name: string
          field_order: number | null
          id: string
          is_active: boolean | null
          severity: string
        }
        Insert: {
          applies_to_checklist?: boolean | null
          applies_to_hbl?: boolean | null
          comparison_type?: string
          created_at?: string | null
          description?: string | null
          field_label: string
          field_name: string
          field_order?: number | null
          id?: string
          is_active?: boolean | null
          severity?: string
        }
        Update: {
          applies_to_checklist?: boolean | null
          applies_to_hbl?: boolean | null
          comparison_type?: string
          created_at?: string | null
          description?: string | null
          field_label?: string
          field_name?: string
          field_order?: number | null
          id?: string
          is_active?: boolean | null
          severity?: string
        }
        Relationships: []
      }
      si_reconciliation_records: {
        Row: {
          block_reason: string | null
          can_submit_si: boolean | null
          comparison_document_type: string
          comparison_email_id: string | null
          created_at: string | null
          critical_discrepancies: number | null
          discrepancy_count: number | null
          field_comparisons: Json
          id: string
          matching_fields: number | null
          reconciliation_status: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          si_draft_email_id: string | null
          total_fields_compared: number | null
          updated_at: string | null
        }
        Insert: {
          block_reason?: string | null
          can_submit_si?: boolean | null
          comparison_document_type: string
          comparison_email_id?: string | null
          created_at?: string | null
          critical_discrepancies?: number | null
          discrepancy_count?: number | null
          field_comparisons?: Json
          id?: string
          matching_fields?: number | null
          reconciliation_status?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id: string
          si_draft_email_id?: string | null
          total_fields_compared?: number | null
          updated_at?: string | null
        }
        Update: {
          block_reason?: string | null
          can_submit_si?: boolean | null
          comparison_document_type?: string
          comparison_email_id?: string | null
          created_at?: string | null
          critical_discrepancies?: number | null
          discrepancy_count?: number | null
          field_comparisons?: Json
          id?: string
          matching_fields?: number | null
          reconciliation_status?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id?: string
          si_draft_email_id?: string | null
          total_fields_compared?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "si_reconciliation_records_comparison_email_id_fkey"
            columns: ["comparison_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "si_reconciliation_records_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "si_reconciliation_records_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "si_reconciliation_records_si_draft_email_id_fkey"
            columns: ["si_draft_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_behavior_metrics: {
        Row: {
          amendment_count: number | null
          avg_response_time_hours: number | null
          avg_sentiment_score: number | null
          calculated_at: string | null
          container_count: number | null
          cost: number | null
          created_at: string | null
          email_count: number | null
          id: string
          metric_period: string
          on_time_rate: number | null
          party_id: string
          period_end: string
          period_start: string
          revenue: number | null
          shipment_count: number | null
        }
        Insert: {
          amendment_count?: number | null
          avg_response_time_hours?: number | null
          avg_sentiment_score?: number | null
          calculated_at?: string | null
          container_count?: number | null
          cost?: number | null
          created_at?: string | null
          email_count?: number | null
          id?: string
          metric_period: string
          on_time_rate?: number | null
          party_id: string
          period_end: string
          period_start: string
          revenue?: number | null
          shipment_count?: number | null
        }
        Update: {
          amendment_count?: number | null
          avg_response_time_hours?: number | null
          avg_sentiment_score?: number | null
          calculated_at?: string | null
          container_count?: number | null
          cost?: number | null
          created_at?: string | null
          email_count?: number | null
          id?: string
          metric_period?: string
          on_time_rate?: number | null
          party_id?: string
          period_end?: string
          period_start?: string
          revenue?: number | null
          shipment_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_behavior_metrics_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_communication_timeline: {
        Row: {
          communication_log_id: string | null
          communication_type: string
          created_at: string | null
          direction: string
          document_lifecycle_id: string | null
          document_type: string | null
          email_id: string | null
          id: string
          notification_id: string | null
          occurred_at: string
          party_id: string | null
          requires_response: boolean | null
          response_due_date: string | null
          response_received: boolean | null
          response_time_hours: number | null
          response_timeline_id: string | null
          shipment_id: string | null
          subject: string | null
          summary: string | null
          task_id: string | null
          triggered_milestone: string | null
          triggered_workflow_state: string | null
        }
        Insert: {
          communication_log_id?: string | null
          communication_type: string
          created_at?: string | null
          direction: string
          document_lifecycle_id?: string | null
          document_type?: string | null
          email_id?: string | null
          id?: string
          notification_id?: string | null
          occurred_at: string
          party_id?: string | null
          requires_response?: boolean | null
          response_due_date?: string | null
          response_received?: boolean | null
          response_time_hours?: number | null
          response_timeline_id?: string | null
          shipment_id?: string | null
          subject?: string | null
          summary?: string | null
          task_id?: string | null
          triggered_milestone?: string | null
          triggered_workflow_state?: string | null
        }
        Update: {
          communication_log_id?: string | null
          communication_type?: string
          created_at?: string | null
          direction?: string
          document_lifecycle_id?: string | null
          document_type?: string | null
          email_id?: string | null
          id?: string
          notification_id?: string | null
          occurred_at?: string
          party_id?: string | null
          requires_response?: boolean | null
          response_due_date?: string | null
          response_received?: boolean | null
          response_time_hours?: number | null
          response_timeline_id?: string | null
          shipment_id?: string | null
          subject?: string | null
          summary?: string | null
          task_id?: string | null
          triggered_milestone?: string | null
          triggered_workflow_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_communication_timeline_communication_log_id_fkey"
            columns: ["communication_log_id"]
            isOneToOne: false
            referencedRelation: "communication_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_document_lifecycle_id_fkey"
            columns: ["document_lifecycle_id"]
            isOneToOne: false
            referencedRelation: "document_lifecycle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_response_timeline_id_fkey"
            columns: ["response_timeline_id"]
            isOneToOne: false
            referencedRelation: "stakeholder_communication_timeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipment_journey_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communication_timeline_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_communications: {
        Row: {
          action_items: Json | null
          communication_direction: string
          communication_timestamp: string | null
          communication_type: string
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          full_content: string | null
          id: string
          key_topics: string[] | null
          party_id: string | null
          requires_response: boolean | null
          responded_at: string | null
          response_deadline: string | null
          response_time_hours: number | null
          sentiment: string | null
          sentiment_score: number | null
          shipment_id: string | null
          source_email_id: string | null
          subject: string | null
          summary: string | null
          topic_category: string | null
          urgency_level: string | null
          vendor_id: string | null
        }
        Insert: {
          action_items?: Json | null
          communication_direction: string
          communication_timestamp?: string | null
          communication_type: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          full_content?: string | null
          id?: string
          key_topics?: string[] | null
          party_id?: string | null
          requires_response?: boolean | null
          responded_at?: string | null
          response_deadline?: string | null
          response_time_hours?: number | null
          sentiment?: string | null
          sentiment_score?: number | null
          shipment_id?: string | null
          source_email_id?: string | null
          subject?: string | null
          summary?: string | null
          topic_category?: string | null
          urgency_level?: string | null
          vendor_id?: string | null
        }
        Update: {
          action_items?: Json | null
          communication_direction?: string
          communication_timestamp?: string | null
          communication_type?: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          full_content?: string | null
          id?: string
          key_topics?: string[] | null
          party_id?: string | null
          requires_response?: boolean | null
          responded_at?: string | null
          response_deadline?: string | null
          response_time_hours?: number | null
          sentiment?: string | null
          sentiment_score?: number | null
          shipment_id?: string | null
          source_email_id?: string | null
          subject?: string | null
          summary?: string | null
          topic_category?: string | null
          urgency_level?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_communications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communications_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_communications_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_extraction_queue: {
        Row: {
          created_at: string | null
          created_party_ids: string[] | null
          email_id: string
          error_message: string | null
          extracted_parties: Json | null
          extraction_status: string
          id: string
          matched_party_ids: string[] | null
          processed_at: string | null
          queued_at: string | null
          retry_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_party_ids?: string[] | null
          email_id: string
          error_message?: string | null
          extracted_parties?: Json | null
          extraction_status?: string
          id?: string
          matched_party_ids?: string[] | null
          processed_at?: string | null
          queued_at?: string | null
          retry_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_party_ids?: string[] | null
          email_id?: string
          error_message?: string | null
          extracted_parties?: Json | null
          extraction_status?: string
          id?: string
          matched_party_ids?: string[] | null
          processed_at?: string | null
          queued_at?: string | null
          retry_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_extraction_queue_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: true
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_relationships: {
        Row: {
          created_at: string | null
          first_shipment_date: string | null
          id: string
          last_shipment_date: string | null
          party_a_id: string
          party_b_id: string
          relationship_type: string
          shipment_count: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          first_shipment_date?: string | null
          id?: string
          last_shipment_date?: string | null
          party_a_id: string
          party_b_id: string
          relationship_type: string
          shipment_count?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          first_shipment_date?: string | null
          id?: string
          last_shipment_date?: string | null
          party_a_id?: string
          party_b_id?: string
          relationship_type?: string
          shipment_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_relationships_party_a_id_fkey"
            columns: ["party_a_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_relationships_party_b_id_fkey"
            columns: ["party_b_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_sentiment_log: {
        Row: {
          analyzed_at: string | null
          confidence: number | null
          created_at: string | null
          email_snippet: string | null
          id: string
          key_topics: string[] | null
          party_id: string
          sentiment: string
          sentiment_score: number
          source_email_id: string | null
          topic_category: string | null
        }
        Insert: {
          analyzed_at?: string | null
          confidence?: number | null
          created_at?: string | null
          email_snippet?: string | null
          id?: string
          key_topics?: string[] | null
          party_id: string
          sentiment: string
          sentiment_score: number
          source_email_id?: string | null
          topic_category?: string | null
        }
        Update: {
          analyzed_at?: string | null
          confidence?: number | null
          created_at?: string | null
          email_snippet?: string | null
          id?: string
          key_topics?: string[] | null
          party_id?: string
          sentiment?: string
          sentiment_score?: number
          source_email_id?: string | null
          topic_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_sentiment_log_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_sentiment_log_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      structured_extractions: {
        Row: {
          attachment_id: string | null
          classification_id: string | null
          confidence_score: number
          corrected_data: Json | null
          created_at: string | null
          email_id: string | null
          extracted_at: string | null
          extracted_data: Json
          extraction_completeness: number | null
          extraction_prompt_version: string | null
          feedback_at: string | null
          feedback_by: string | null
          id: string
          is_correct: boolean | null
          missing_fields: string[] | null
          model_name: string
          model_version: string
          validation_errors: Json | null
        }
        Insert: {
          attachment_id?: string | null
          classification_id?: string | null
          confidence_score: number
          corrected_data?: Json | null
          created_at?: string | null
          email_id?: string | null
          extracted_at?: string | null
          extracted_data: Json
          extraction_completeness?: number | null
          extraction_prompt_version?: string | null
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          is_correct?: boolean | null
          missing_fields?: string[] | null
          model_name: string
          model_version: string
          validation_errors?: Json | null
        }
        Update: {
          attachment_id?: string | null
          classification_id?: string | null
          confidence_score?: number
          corrected_data?: Json | null
          created_at?: string | null
          email_id?: string | null
          extracted_at?: string | null
          extracted_data?: Json
          extraction_completeness?: number | null
          extraction_prompt_version?: string | null
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          is_correct?: boolean | null
          missing_fields?: string[] | null
          model_name?: string
          model_version?: string
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "structured_extractions_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "raw_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_extractions_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "document_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_extractions_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity_log: {
        Row: {
          activity_type: string
          change_reason: string | null
          id: string
          is_system_action: boolean | null
          new_value: Json | null
          old_value: Json | null
          performed_at: string | null
          performed_by: string | null
          performed_by_name: string | null
          task_id: string
        }
        Insert: {
          activity_type: string
          change_reason?: string | null
          id?: string
          is_system_action?: boolean | null
          new_value?: Json | null
          old_value?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          task_id: string
        }
        Update: {
          activity_type?: string
          change_reason?: string | null
          id?: string
          is_system_action?: boolean | null
          new_value?: Json | null
          old_value?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_insights: {
        Row: {
          confidence_score: number | null
          content: string
          created_at: string | null
          generated_at: string | null
          id: string
          insight_type: string
          supporting_data: Json | null
          task_id: string
          title: string
        }
        Insert: {
          confidence_score?: number | null
          content: string
          created_at?: string | null
          generated_at?: string | null
          id?: string
          insight_type: string
          supporting_data?: Json | null
          task_id: string
          title: string
        }
        Update: {
          confidence_score?: number | null
          content?: string
          created_at?: string | null
          generated_at?: string | null
          id?: string
          insight_type?: string
          supporting_data?: Json | null
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_insights_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "action_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_insights_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_active_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          base_priority: string | null
          created_at: string | null
          default_description_template: string | null
          default_recipients: Json | null
          default_title_template: string
          email_body_template: string | null
          email_subject_template: string | null
          has_email_template: boolean | null
          id: string
          is_active: boolean | null
          priority_boost_conditions: Json | null
          template_category: string
          template_code: string
          template_description: string | null
          template_name: string
          trigger_conditions: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          base_priority?: string | null
          created_at?: string | null
          default_description_template?: string | null
          default_recipients?: Json | null
          default_title_template: string
          email_body_template?: string | null
          email_subject_template?: string | null
          has_email_template?: boolean | null
          id?: string
          is_active?: boolean | null
          priority_boost_conditions?: Json | null
          template_category: string
          template_code: string
          template_description?: string | null
          template_name: string
          trigger_conditions?: Json | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          base_priority?: string | null
          created_at?: string | null
          default_description_template?: string | null
          default_recipients?: Json | null
          default_title_template?: string
          email_body_template?: string | null
          email_subject_template?: string | null
          has_email_template?: boolean | null
          id?: string
          is_active?: boolean | null
          priority_boost_conditions?: Json | null
          template_category?: string
          template_code?: string
          template_description?: string | null
          template_name?: string
          trigger_conditions?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      vendor_performance_log: {
        Row: {
          actual_value: string | null
          cost_impact: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          event_category: string
          event_date: string
          event_type: string
          expected_value: string | null
          id: string
          performance_rating: number | null
          shipment_id: string | null
          source_email_id: string | null
          variance_value: string | null
          vendor_id: string
        }
        Insert: {
          actual_value?: string | null
          cost_impact?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          event_category: string
          event_date: string
          event_type: string
          expected_value?: string | null
          id?: string
          performance_rating?: number | null
          shipment_id?: string | null
          source_email_id?: string | null
          variance_value?: string | null
          vendor_id: string
        }
        Update: {
          actual_value?: string | null
          cost_impact?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          event_category?: string
          event_date?: string
          event_type?: string
          expected_value?: string | null
          id?: string
          performance_rating?: number | null
          shipment_id?: string | null
          source_email_id?: string | null
          variance_value?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_performance_log_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_performance_log_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          average_invoice_value: number | null
          average_response_time_hours: number | null
          bank_account_number: string | null
          bank_ifsc_code: string | null
          bank_name: string | null
          city: string | null
          common_issues: string[] | null
          country: string | null
          created_at: string | null
          created_by: string | null
          credit_days: number | null
          id: string
          on_time_delivery_rate: number | null
          pan_number: string | null
          payment_terms: string | null
          performance_rating: number | null
          preferred_for_services: string[] | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          service_quality_score: number | null
          status: string | null
          tax_id: string | null
          total_amount_paid: number | null
          total_transactions: number | null
          updated_at: string | null
          vendor_category: string | null
          vendor_code: string
          vendor_legal_name: string | null
          vendor_name: string
          vendor_type: string
        }
        Insert: {
          address?: string | null
          average_invoice_value?: number | null
          average_response_time_hours?: number | null
          bank_account_number?: string | null
          bank_ifsc_code?: string | null
          bank_name?: string | null
          city?: string | null
          common_issues?: string[] | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          credit_days?: number | null
          id?: string
          on_time_delivery_rate?: number | null
          pan_number?: string | null
          payment_terms?: string | null
          performance_rating?: number | null
          preferred_for_services?: string[] | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          service_quality_score?: number | null
          status?: string | null
          tax_id?: string | null
          total_amount_paid?: number | null
          total_transactions?: number | null
          updated_at?: string | null
          vendor_category?: string | null
          vendor_code: string
          vendor_legal_name?: string | null
          vendor_name: string
          vendor_type: string
        }
        Update: {
          address?: string | null
          average_invoice_value?: number | null
          average_response_time_hours?: number | null
          bank_account_number?: string | null
          bank_ifsc_code?: string | null
          bank_name?: string | null
          city?: string | null
          common_issues?: string[] | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          credit_days?: number | null
          id?: string
          on_time_delivery_rate?: number | null
          pan_number?: string | null
          payment_terms?: string | null
          performance_rating?: number | null
          preferred_for_services?: string[] | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          service_quality_score?: number | null
          status?: string | null
          tax_id?: string | null
          total_amount_paid?: number | null
          total_transactions?: number | null
          updated_at?: string | null
          vendor_category?: string | null
          vendor_code?: string
          vendor_legal_name?: string | null
          vendor_name?: string
          vendor_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      classification_accuracy_trends: {
        Row: {
          active_reviewers: number | null
          avg_accuracy_improvement: number | null
          feedback_count: number | null
          feedback_date: string | null
          total_emails_affected: number | null
        }
        Relationships: []
      }
      feedback_impact_summary: {
        Row: {
          accuracy_improvement: number | null
          action_type: string | null
          classifications_corrected: number | null
          corrected_classification: string | null
          emails_affected: number | null
          feedback_id: string | null
          feedback_type: string | null
          is_active: boolean | null
          is_approved: boolean | null
          processing_status: string | null
          rule_name: string | null
          submitted_at: string | null
          submitted_by: string | null
        }
        Relationships: []
      }
      pending_feedback_queue: {
        Row: {
          classification_explanation: string | null
          corrected_classification: string | null
          current_classification: string | null
          current_confidence: number | null
          email_id: string | null
          email_received_at: string | null
          email_subject: string | null
          feedback_type: string | null
          id: string | null
          sender_email: string | null
          submitted_at: string | null
          submitted_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classification_feedback_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "raw_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      v_active_tasks: {
        Row: {
          assigned_to_name: string | null
          booking_number: string | null
          carrier_name: string | null
          category: string | null
          created_at: string | null
          due_date: string | null
          id: string | null
          priority: string | null
          priority_factors: Json | null
          priority_score: number | null
          status: string | null
          task_number: string | null
          title: string | null
          urgency_level: string | null
          vessel_name: string | null
        }
        Relationships: []
      }
      v_booking_revision_history: {
        Row: {
          booking_number: string | null
          changed_fields: Json | null
          created_at: string | null
          eta: string | null
          etd: string | null
          port_of_discharge: string | null
          port_of_loading: string | null
          revision_number: number | null
          revision_received_at: string | null
          revision_type: string | null
          source_email_subject: string | null
          vessel_name: string | null
          voyage_number: string | null
        }
        Relationships: []
      }
      v_shipment_journey_status: {
        Row: {
          active_blockers: number | null
          bl_number: string | null
          booking_number: string | null
          carrier_name: string | null
          consignee_name: string | null
          created_at: string | null
          critical_blockers: number | null
          days_to_etd: number | null
          docs_approved: number | null
          docs_awaiting_ack: number | null
          docs_missing: number | null
          emails_awaiting_response: number | null
          eta: string | null
          etd: string | null
          high_priority_tasks: number | null
          id: string | null
          journey_progress_pct: number | null
          milestones_completed: number | null
          milestones_missed: number | null
          milestones_pending: number | null
          pending_tasks: number | null
          shipper_name: string | null
          si_cutoff_imminent: boolean | null
          status: string | null
          total_documents: number | null
          updated_at: string | null
          vgm_cutoff_imminent: boolean | null
          workflow_phase: string | null
          workflow_state: string | null
          workflow_state_updated_at: string | null
        }
        Relationships: []
      }
      v_thread_summary: {
        Row: {
          document_types_count: number | null
          duplicate_count: number | null
          email_count: number | null
          entity_types_count: number | null
          first_email_at: string | null
          latest_email_at: string | null
          primary_bl_number: string | null
          primary_booking_number: string | null
          thread_id: string | null
          thread_subject: string | null
          unique_email_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      archive_completed_shipment: {
        Args: { p_shipment_id: string }
        Returns: Json
      }
      calculate_link_confidence: {
        Args: {
          p_email_received_at: string
          p_matching_entities: Json
          p_shipment_id: string
        }
        Returns: number
      }
      calculate_notification_urgency: {
        Args: {
          p_deadline_date: string
          p_notification_type: string
          p_priority: string
        }
        Returns: number
      }
      calculate_task_priority_score: {
        Args: {
          p_customer_tier: string
          p_document_is_critical: boolean
          p_due_date: string
          p_has_past_delays: boolean
          p_notification_type: string
          p_stakeholder_reliability_score: number
        }
        Returns: {
          factors: Json
          priority: string
          total_score: number
        }[]
      }
      calculate_vendor_performance: {
        Args: { p_vendor_id: string }
        Returns: number
      }
      detect_customer_preferences: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      detect_shipment_blockers: {
        Args: { p_shipment_id: string }
        Returns: number
      }
      extract_revision_number: {
        Args: { subject: string }
        Returns: {
          revision_label: string
          revision_number: number
        }[]
      }
      format_task_number: { Args: { task_number: number }; Returns: string }
      get_feedback_statistics: {
        Args: never
        Returns: {
          active_rules_count: number
          avg_accuracy_improvement: number
          pending_count: number
          processed_count: number
          total_emails_affected: number
          total_feedback_count: number
        }[]
      }
      get_shipment_journey: {
        Args: { p_shipment_id: string }
        Returns: {
          category: string
          description: string
          direction: string
          event_time: string
          event_type: string
          party_name: string
          workflow_impact: string
        }[]
      }
      submit_classification_feedback: {
        Args: {
          p_corrected_classification: string
          p_email_id: string
          p_explanation: string
          p_pattern_description?: string
          p_submitted_by?: string
        }
        Returns: string
      }
      update_customer_metrics: {
        Args: { p_customer_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
