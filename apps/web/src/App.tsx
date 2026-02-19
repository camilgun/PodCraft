import { Routes, Route, Navigate } from "react-router";
import { LibraryPage } from "@/pages/library-page";
import { RecordingDetailPage } from "@/pages/recording-detail-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/recordings/:id" element={<RecordingDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
