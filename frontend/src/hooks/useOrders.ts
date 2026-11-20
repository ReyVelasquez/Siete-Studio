import { useCallback, useEffect, useState } from "react";
import { ordersService, type OrderFilters } from "@/services/orders.service";
import type { OrderItem } from "@/types/order";

export function useOrders(filters: OrderFilters) {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await ordersService.listAdminOrders(filters);
      setOrders(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando pedidos.");
    } finally {
      setLoading(false);
    }
  }, [
    filters.status,
    filters.material,
    filters.shape,
    filters.search,
    filters.only_pending,
    filters.delivery_date,
  ]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const replaceOrderLocally = useCallback((updated: OrderItem) => {
    setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }, []);

  return {
    orders,
    total,
    loading,
    error,
    refetch: fetchOrders,
    replaceOrderLocally,
  };
}
