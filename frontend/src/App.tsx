import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/hooks/useToast";
import { DashboardHomePage } from "@/pages/DashboardHomePage";
import { DieCutStudioPage } from "@/pages/DieCutStudioPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ImageEnhancerPage } from "@/pages/ImageEnhancerPage";
import { LoginPage } from "@/pages/LoginPage";
import { MaterialsCatalogPage } from "@/pages/MaterialsCatalogPage";
import { OrdersManagementPage } from "@/pages/OrdersManagementPage";
import { ProfileSecurityPage } from "@/pages/ProfileSecurityPage";
import { PublicOrderPage } from "@/pages/PublicOrderPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { UsersManagementPage } from "@/pages/UsersManagementPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Storefront & Order Intake */}
              <Route path="/" element={<PublicOrderPage />} />

              {/* Authentication & Email Verification Routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route
                path="/verify-email"
                element={
                  <ProtectedRoute allowUnverified>
                    <VerifyEmailPage />
                  </ProtectedRoute>
                }
              />

              {/* Protected Internal Admin, CRUD & Security Dashboard */}
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
                <Route path="image-enhancer" element={<ImageEnhancerPage />} />
                <Route path="die-cut" element={<DieCutStudioPage />} />
                <Route path="materials" element={<MaterialsCatalogPage />} />
                <Route path="users" element={<UsersManagementPage />} />
                <Route path="profile" element={<ProfileSecurityPage />} />
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
