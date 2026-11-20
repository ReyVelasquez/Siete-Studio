import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/hooks/useToast";
import { DashboardHomePage } from "@/pages/DashboardHomePage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { LoginPage } from "@/pages/LoginPage";
import { OrdersManagementPage } from "@/pages/OrdersManagementPage";
import { PublicOrderPage } from "@/pages/PublicOrderPage";
import { RegisterPage } from "@/pages/RegisterPage";

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Storefront & Order Intake */}
              <Route path="/" element={<PublicOrderPage />} />

              {/* Authentication Routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />

              {/* Protected Internal Admin & Sales Dashboard */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardHomePage />} />
                <Route path="orders" element={<OrdersManagementPage />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <ToastContainer />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
