import 'package:flutter/material.dart';

import 'app.dart';
import 'state/app_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  AppController? controller;
  String? bootFailure;
  try {
    controller = await AppController.launch();
  } on Object catch (error) {
    bootFailure = '$error';
  }

  runApp(KarsaBusinessApp(controller: controller, bootFailure: bootFailure));
}
