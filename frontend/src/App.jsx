import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import AppLayout from './layouts/AppLayout';
import DashboardPage from './pages/DashboardPage';
import MasterResumePage from './pages/MasterResumePage';
import JobAnalysisPage from './pages/JobAnalysisPage';
import JobAnalysisDetailPage from './pages/JobAnalysisDetailPage';
import TailoredResumePage from './pages/TailoredResumePage';
import ApplicationsPage from './pages/ApplicationsPage';
import ApplicationBoardPage from './pages/ApplicationBoardPage';
import ApplicationFormPage from './pages/ApplicationFormPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import AuthPage from './pages/AuthPage';
import NotFoundPage from './pages/NotFoundPage';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import { GuestOnly, RequireAuth } from './components/RouteGuards';

// Routes are added here as each phase delivers working pages (no placeholder screens).
const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', element: <AuthPage mode="login" /> },
          { path: 'register', element: <AuthPage mode="register" /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'master-resume', element: <MasterResumePage /> },
          { path: 'job-analysis', element: <JobAnalysisPage /> },
          { path: 'job-analysis/:id', element: <JobAnalysisDetailPage /> },
          { path: 'tailored-resumes/:id', element: <TailoredResumePage /> },
          { path: 'applications', element: <ApplicationsPage /> },
          { path: 'applications/board', element: <ApplicationBoardPage /> },
          { path: 'applications/new', element: <ApplicationFormPage /> },
          { path: 'applications/:id', element: <ApplicationDetailPage /> },
          { path: 'applications/:id/edit', element: <ApplicationFormPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
