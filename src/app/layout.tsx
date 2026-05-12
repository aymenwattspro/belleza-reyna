import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import { AppLayout } from '@/components/layout/AppLayout';
import { OrderProvider } from '@/contexts/OrderContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { ProductSettingsProvider } from '@/contexts/ProductSettingsContext';
import { InventoryProvider } from '@/contexts/InventoryContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap', // Never block page paint waiting for the font
});

export const metadata: Metadata = {
  title: 'Belleza Reyna | Inventory Management',
  description: 'Professional inventory management for Productos de Belleza Reyna',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} antialiased`}>
      <body className="font-sans">
        <AuthProvider>
          <LanguageProvider>
            <InventoryProvider>
              <ChatProvider>
                <OrderProvider>
                  <ProductSettingsProvider>
                    <AppLayout>{children}</AppLayout>
                  </ProductSettingsProvider>
                </OrderProvider>
              </ChatProvider>
            </InventoryProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
