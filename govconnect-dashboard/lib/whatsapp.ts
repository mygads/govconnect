/**
 * WhatsApp Integration Utilities
 * Functions for generating WhatsApp links and handling WhatsApp interactions
 */

export interface WhatsAppConfig {
  phoneNumber: string;
  defaultMessage: string;
}

// Default WhatsApp configuration for Tanggapin AI
export const WHATSAPP_CONFIG: WhatsAppConfig = {
  phoneNumber: "6281233784490",
  defaultMessage: "Halo, saya ingin bertanya tentang Tanggapin AI",
};

/**
 * Validates Indonesian phone number format
 * Accepts formats: 08xxx, 628xxx, +628xxx
 */
export function validatePhoneNumber(phone: string): boolean {
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, "");
  
  // Check if it matches Indonesian phone number patterns
  const patterns = [
    /^08\d{8,11}$/,      // 08xxxxxxxxx
    /^628\d{8,11}$/,     // 628xxxxxxxxx
    /^\+628\d{8,11}$/,   // +628xxxxxxxxx
  ];
  
  return patterns.some(pattern => pattern.test(cleaned));
}

/**
 * Normalizes phone number to international format (without +)
 * Converts 08xxx to 628xxx
 */
export function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, "");
  
  // Convert 08xxx to 628xxx
  if (cleaned.startsWith("08")) {
    return "62" + cleaned.substring(1);
  }
  
  // Remove leading + if present
  if (cleaned.startsWith("62")) {
    return cleaned;
  }
  
  return cleaned;
}

/**
 * Generates a WhatsApp web/app link
 * @param phone - Phone number (will be normalized)
 * @param message - Pre-filled message (will be URL encoded)
 * @returns WhatsApp link URL
 */
export function generateWhatsAppLink(
  phone: string = WHATSAPP_CONFIG.phoneNumber,
  message: string = WHATSAPP_CONFIG.defaultMessage
): string {
  try {
    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);
    
    // Validate phone number
    if (!validatePhoneNumber(normalizedPhone)) {
      console.warn(`Invalid phone number: ${phone}`);
      // Return link without message as fallback
      return `https://wa.me/${normalizedPhone}`;
    }
    
    // Encode message for URL
    const encodedMessage = encodeURIComponent(message);
    
    // Generate WhatsApp link
    return `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
  } catch (error) {
    console.error("Failed to generate WhatsApp link:", error);
    // Return basic link as fallback
    return `https://wa.me/${normalizePhoneNumber(phone)}`;
  }
}

/**
 * Opens WhatsApp in a new window/tab
 * Detects mobile vs desktop and opens appropriate interface
 */
export function openWhatsApp(
  phone: string = WHATSAPP_CONFIG.phoneNumber,
  message: string = WHATSAPP_CONFIG.defaultMessage
): void {
  const link = generateWhatsAppLink(phone, message);
  
  // Open in new tab
  window.open(link, "_blank", "noopener,noreferrer");
}

/**
 * Checks if user is on mobile device
 * Used to determine whether to open WhatsApp app or web
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Gets the appropriate WhatsApp link based on device
 * Mobile: Opens app directly
 * Desktop: Opens WhatsApp Web
 */
export function getDeviceSpecificWhatsAppLink(
  phone: string = WHATSAPP_CONFIG.phoneNumber,
  message: string = WHATSAPP_CONFIG.defaultMessage
): string {
  const normalizedPhone = normalizePhoneNumber(phone);
  const encodedMessage = encodeURIComponent(message);
  
  if (isMobileDevice()) {
    // Mobile: Use whatsapp:// protocol to open app
    return `whatsapp://send?phone=${normalizedPhone}&text=${encodedMessage}`;
  } else {
    // Desktop: Use wa.me link for WhatsApp Web
    return `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
  }
}
