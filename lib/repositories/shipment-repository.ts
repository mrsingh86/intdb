/**
 * Shipment Repository
 *
 * Abstracts all database access for shipments.
 * Follows same pattern as EmailRepository.
 *
 * Principles:
 * - Information Hiding: Hides Supabase implementation
 * - Single Responsibility: Only database access
 * - No Null Returns: Throws exceptions or returns empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Shipment, ShipmentStatus } from '@/types/shipment';
import { PaginationOptions, PaginatedResult } from '../types/repository-filters';
import { sanitizeContainerNumber } from '../utils';

export interface ShipmentQueryFilters {
  status?: ShipmentStatus[];
  carrier_id?: string;
  shipper_id?: string;
  consignee_id?: string;
  search?: string; // Search in booking #, BL #, vessel name
  is_direct_carrier_confirmed?: boolean; // Filter to "real" shipments (from direct carrier booking confirmation)
}

export class ShipmentNotFoundError extends Error {
  constructor(public shipmentId: string) {
    super(`Shipment not found: ${shipmentId}`);
    this.name = 'ShipmentNotFoundError';
  }
}

export class ShipmentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find all shipments with filters and pagination
   */
  async findAll(
    filters: ShipmentQueryFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<Shipment>> {
    const offset = (pagination.page - 1) * pagination.limit;

    let query = this.supabase
      .from('shipments')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pagination.limit - 1);

    // Apply filters
    if (filters.status && filters.status.length > 0) {
      query = query.in('status', filters.status);
    }

    if (filters.carrier_id) {
      query = query.eq('carrier_id', filters.carrier_id);
    }

    if (filters.shipper_id) {
      query = query.eq('shipper_id', filters.shipper_id);
    }

    if (filters.consignee_id) {
      query = query.eq('consignee_id', filters.consignee_id);
    }

    if (filters.search) {
      query = query.or(
        `booking_number.ilike.%${filters.search}%,bl_number.ilike.%${filters.search}%,vessel_name.ilike.%${filters.search}%`
      );
    }

    // Filter to "real" shipments (direct carrier booking confirmation)
    if (filters.is_direct_carrier_confirmed !== undefined) {
      query = query.eq('is_direct_carrier_confirmed', filters.is_direct_carrier_confirmed);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch shipments: ${error.message}`);
    }

    return {
      data: data || [],
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pagination.limit),
      },
    };
  }

  /**
   * Find shipment by ID
   * @throws ShipmentNotFoundError if not found
   */
  async findById(id: string): Promise<Shipment> {
    const { data, error } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new ShipmentNotFoundError(id);
    }

    return data;
  }

  /**
   * Find shipment by booking number
   */
  async findByBookingNumber(bookingNumber: string): Promise<Shipment | null> {
    const { data, error } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Find shipment by BL number
   */
  async findByBlNumber(blNumber: string): Promise<Shipment | null> {
    const { data, error } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('bl_number', blNumber)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Find shipment by container number
   * Checks both shipments.container_number_primary AND shipment_containers table
   */
  async findByContainerNumber(containerNumber: string): Promise<Shipment | null> {
    // 1. Check shipments.container_number_primary
    const { data: primaryMatch } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('container_number_primary', containerNumber)
      .limit(1);

    if (primaryMatch && primaryMatch.length > 0) {
      return primaryMatch[0];
    }

    // 2. Check shipments.container_numbers array (JSON contains)
    const { data: arrayMatch } = await this.supabase
      .from('shipments')
      .select('*')
      .contains('container_numbers', [containerNumber])
      .limit(1);

    if (arrayMatch && arrayMatch.length > 0) {
      return arrayMatch[0];
    }

    // 3. Check shipment_containers table (legacy/detailed container records)
    const { data: containerMatch } = await this.supabase
      .from('shipment_containers')
      .select('shipment_id')
      .eq('container_number', containerNumber)
      .limit(1);

    if (containerMatch && containerMatch.length > 0) {
      try {
        return await this.findById(containerMatch[0].shipment_id);
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Create a new shipment
   * @throws Error if creation fails
   */
  async create(shipment: Partial<Shipment>): Promise<Shipment> {
    // Sanitize container number to prevent garbage data
    const sanitizedShipment = {
      ...shipment,
      container_number_primary: sanitizeContainerNumber(
        shipment.container_number_primary
      ),
    };

    const { data, error } = await this.supabase
      .from('shipments')
      .insert(sanitizedShipment)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create shipment: ${error?.message}`);
    }

    return data;
  }

  /**
   * Update existing shipment
   */
  async update(id: string, updates: Partial<Shipment>): Promise<Shipment> {
    // Sanitize container number if being updated
    const sanitizedUpdates = { ...updates };
    if ('container_number_primary' in updates) {
      sanitizedUpdates.container_number_primary = sanitizeContainerNumber(
        updates.container_number_primary
      );
    }

    const { data, error } = await this.supabase
      .from('shipments')
      .update(sanitizedUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update shipment: ${error?.message}`);
    }

    return data;
  }

  /**
   * Update shipment status
   */
  async updateStatus(id: string, status: ShipmentStatus): Promise<Shipment> {
    return this.update(id, {
      status,
      status_updated_at: new Date().toISOString(),
    });
  }

  /**
   * Count shipments by status
   */
  async countByStatus(status: ShipmentStatus): Promise<number> {
    const { count, error } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);

    if (error) {
      throw new Error(`Failed to count shipments: ${error.message}`);
    }

    return count || 0;
  }
}
