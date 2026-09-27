import 'package:flutter/material.dart';

void main() => runApp(const KarsaBusinessApp());

class KarsaBusinessApp extends StatelessWidget {
  const KarsaBusinessApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Karsa Business',
      home: Scaffold(
        body: Center(
          child: Text('Karsa Business', style: Theme.of(context).textTheme.headlineSmall),
        ),
      ),
    );
  }
}
