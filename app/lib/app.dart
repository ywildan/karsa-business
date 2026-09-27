import 'package:flutter/material.dart';

import 'features/onboarding/onboarding_screen.dart';
import 'features/shell/home_shell.dart';
import 'state/app_controller.dart';
import 'theme/app_theme.dart';

class KarsaBusinessApp extends StatelessWidget {
  const KarsaBusinessApp({super.key, this.controller, this.bootFailure});

  final AppController? controller;
  final String? bootFailure;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Karsa Business',
      debugShowCheckedModeBanner: false,
      theme: KarsaTheme.light(),
      darkTheme: KarsaTheme.dark(),
      home: _Root(controller: controller, bootFailure: bootFailure),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root({this.controller, this.bootFailure});

  final AppController? controller;
  final String? bootFailure;

  @override
  Widget build(BuildContext context) {
    final app = controller;
    if (app == null) {
      return _BrokenDatabase(
        message: bootFailure ?? 'Basis data tidak terbuka.',
      );
    }
    return ListenableBuilder(
      listenable: app,
      builder: (context, _) => switch (app.stage) {
        AppStage.loading => const _Splash(),
        AppStage.failed => _TryAgain(controller: app),
        AppStage.needsBusiness => OnboardingScreen(controller: app),
        AppStage.ready => HomeShell(controller: app),
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Karsa Business',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
                color: KarsaPalette.accent(Theme.of(context).brightness),
              ),
            ),
            const SizedBox(height: 20),
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            ),
          ],
        ),
      ),
    );
  }
}

class _TryAgain extends StatelessWidget {
  const _TryAgain({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Catatanmu tidak bisa dibaca.',
                style: Theme.of(context).textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Text(
                controller.failure ?? 'Alasannya tidak diketahui.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: () => _reload(context),
                child: const Text('Coba lagi'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _reload(BuildContext context) async {
    await controller.reload();
    if (!context.mounted) return;
    if (controller.stage == AppStage.failed) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(controller.failure ?? 'Masih gagal.')),
      );
    }
  }
}

class _BrokenDatabase extends StatelessWidget {
  const _BrokenDatabase({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Basis data tidak bisa dibuka di perangkat ini.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 10),
              Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
